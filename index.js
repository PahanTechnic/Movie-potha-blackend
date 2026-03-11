require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ✅ FIX 1: 409 Conflict - polling: false කරලා manually start කරනවා
// webhook clear කරලා පසු polling start - duplicate instance problem fix
const tgBot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: false });

async function startBot() {
    try {
        await tgBot.deleteWebHook({ drop_pending_updates: true });
        console.log("✅ Webhook cleared successfully");
        await new Promise(r => setTimeout(r, 1000));
        tgBot.startPolling({ restart: false });
        console.log("✅ Telegram Movie Potha Bot සාර්ථකව ක්‍රියාත්මක වේ...");
        console.log("🤖 Movie Potha Bot ready! Movies + TV Series support enabled.");
    } catch (err) {
        console.error("❌ Bot start error:", err.message);
        setTimeout(startBot, 5000);
    }
}

startBot();

// ═══════════════════════════════════════════════
// 🎬 MOVIE HELPERS
// ═══════════════════════════════════════════════

async function findMovie(tmdbId) {
    try {
        const numericId = parseInt(tmdbId);
        if (isNaN(numericId)) return null;

        // ✅ FIX 2: .single() වෙනුවට .maybeSingle() - PGRST116 error fix
        // .single() → data නැතිනම් crash වෙනවා
        // .maybeSingle() → data නැතිනම් null return කරනවා (safe)
        const { data, error } = await supabase
            .from('movies')
            .select('*')
            .eq('tmdb_id', numericId)
            .maybeSingle();

        if (error) { console.error('❌ Movie DB error:', error.message); return null; }
        if (data) console.log(`✅ Movie found: ${data.title}`);
        else console.log(`⚠️ Movie not found: TMDB ID ${numericId}`);
        return data;
    } catch (err) {
        console.error('❌ findMovie exception:', err.message);
        return null;
    }
}

// ═══════════════════════════════════════════════
// 📺 TV SERIES HELPERS
// ═══════════════════════════════════════════════

async function findTVSeries(tmdbId) {
    try {
        const numericId = parseInt(tmdbId);
        if (isNaN(numericId)) return null;

        // ✅ FIX 2 same: .maybeSingle()
        const { data, error } = await supabase
            .from('tv_series')
            .select('*')
            .eq('tmdb_id', numericId)
            .maybeSingle();

        if (error) { console.error('❌ TV DB error:', error.message); return null; }
        if (data) console.log(`✅ TV Series found: ${data.title}`);
        else console.log(`⚠️ TV Series not found: TMDB ID ${numericId}`);
        return data;
    } catch (err) {
        console.error('❌ findTVSeries exception:', err.message);
        return null;
    }
}

async function getTVSeasons(tvSeriesId) {
    try {
        const { data, error } = await supabase
            .from('seasons')
            .select('*')
            .eq('tv_series_id', tvSeriesId)
            .order('season_number', { ascending: true });
        if (error) { console.error('❌ Seasons DB error:', error.message); return []; }
        return data || [];
    } catch (err) {
        console.error('❌ getTVSeasons exception:', err.message);
        return [];
    }
}

async function getTVEpisodes(seasonId) {
    try {
        const { data, error } = await supabase
            .from('episodes')
            .select('*')
            .eq('season_id', seasonId)
            .order('episode_number', { ascending: true });
        if (error) { console.error('❌ Episodes DB error:', error.message); return []; }
        return data || [];
    } catch (err) {
        console.error('❌ getTVEpisodes exception:', err.message);
        return [];
    }
}

// ═══════════════════════════════════════════════
// 💾 USER SESSION
// ═══════════════════════════════════════════════
const userSessions = {};

// ═══════════════════════════════════════════════
// 🚀 /start COMMAND
// ═══════════════════════════════════════════════

tgBot.onText(/\/start(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const param = match[1].trim();

    if (!param || param === '') {
        return tgBot.sendMessage(chatId,
            "👋 *Movie Potha Bot* වෙත සාදරයෙන් පිළිගනිමු!\n\n" +
            "🎬 *Movies:* Website → 'Get on Telegram' click\n\n" +
            "📺 *TV Series:* Website → 'Get on Telegram' click\n" +
            "Season → Episode → Quality තෝරන්න\n\n" +
            "💡 Website: moviepotha.lk",
            { parse_mode: 'Markdown' }
        );
    }

    if (param.startsWith('tv_')) {
        return handleTVStart(chatId, param);
    }

    // ✅ Smart routing: movie check කරලා, නැතිනම් TV series check කරනවා
    // Website එකෙන් tv_ prefix නොදැම්මත් work කරනවා
    return handleSmartStart(chatId, param);
});

// ═══════════════════════════════════════════════
// 🎯 SMART START - Movie හෝ TV Series auto-detect
// ═══════════════════════════════════════════════

async function handleSmartStart(chatId, tmdbId) {
    try {
        // First: movie check
        const movie = await findMovie(tmdbId);
        if (movie) {
            return handleMovieStart(chatId, tmdbId);
        }

        // Second: TV series check
        const tvSeries = await findTVSeries(tmdbId);
        if (tvSeries) {
            console.log(`📺 Auto-detected TV Series for TMDB ID: ${tmdbId}`);
            return handleTVStart(chatId, `tv_${tmdbId}`);
        }

        // Neither found
        return tgBot.sendMessage(chatId,
            `❌ කණගාටුයි, සොයාගත නොහැක.\n\n🔍 TMDB ID: ${tmdbId}\n\nWebsite එකෙන් නැවත try කරන්න.`
        );
    } catch (err) {
        console.error('❌ handleSmartStart error:', err.message);
        tgBot.sendMessage(chatId, "❌ දෝෂයක් ඇතිවිය. නැවත try කරන්න.");
    }
}

// ═══════════════════════════════════════════════
// 🎬 MOVIE START HANDLER
// ═══════════════════════════════════════════════

async function handleMovieStart(chatId, tmdbId) {
    try {
        const movie = await findMovie(tmdbId);

        if (!movie) {
            return tgBot.sendMessage(chatId,
                `❌ කණගාටුයි, මූවී එක සොයාගත නොහැක.\n\n🔍 TMDB ID: ${tmdbId}\n\nWebsite එකෙන් නැවත try කරන්න.`
            );
        }

        let keyboard = [];
        if (movie.tg_file_id_1080 || movie.video_url_1080)
            keyboard.push([{ text: '🔥 1080p - Full HD', callback_data: `movie_${tmdbId}_1080` }]);
        if (movie.tg_file_id_720 || movie.video_url_720)
            keyboard.push([{ text: '⚡ 720p - HD', callback_data: `movie_${tmdbId}_720` }]);
        if (movie.tg_file_id_360 || movie.video_url_360)
            keyboard.push([{ text: '📱 360p - SD', callback_data: `movie_${tmdbId}_360` }]);
        if (keyboard.length === 0 && movie.video_url)
            keyboard.push([{ text: '🎬 Download', callback_data: `movie_${tmdbId}_default` }]);

        if (keyboard.length === 0) {
            return tgBot.sendMessage(chatId,
                `❌ *${movie.title}*\n\nVideo files තවම upload කර නැත.\nපසුව නැවත try කරන්න.`,
                { parse_mode: 'Markdown' }
            );
        }

        const caption =
            `🎬 *${movie.title}*${movie.release_date ? ` (${new Date(movie.release_date).getFullYear()})` : ''}\n\n` +
            `⭐ Rating: ${movie.rating || 'N/A'}\n` +
            `⏱ Duration: ${movie.duration ? movie.duration + ' mins' : 'N/A'}\n\n` +
            `${movie.overview ? movie.overview.substring(0, 200) + '...' : ''}\n\n` +
            `👇 Quality එක තෝරන්න:`;

        const opts = { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } };

        if (movie.poster_url) {
            await tgBot.sendPhoto(chatId, movie.poster_url, { caption, ...opts });
        } else {
            await tgBot.sendMessage(chatId, caption, opts);
        }

    } catch (err) {
        console.error('❌ handleMovieStart error:', err.message);
        tgBot.sendMessage(chatId, "❌ දෝෂයක් ඇතිවිය. නැවත try කරන්න.");
    }
}

// ═══════════════════════════════════════════════
// 📺 TV SERIES START HANDLER
// ═══════════════════════════════════════════════

async function handleTVStart(chatId, param) {
    try {
        const parts = param.split('_');
        const tmdbId = parts[1];

        const tvSeries = await findTVSeries(tmdbId);

        if (!tvSeries) {
            return tgBot.sendMessage(chatId,
                `❌ TV Series සොයාගත නොහැක.\n\nWebsite එකෙන් නැවත try කරන්න.`
            );
        }

        const seasons = await getTVSeasons(tvSeries.id);

        if (seasons.length === 0) {
            return tgBot.sendMessage(chatId,
                `❌ *${tvSeries.title}*\n\nSeasons තවම add කර නැත.`,
                { parse_mode: 'Markdown' }
            );
        }

        userSessions[chatId] = {
            type: 'tv',
            tmdbId,
            tvId: tvSeries.id,
            tvTitle: tvSeries.title,
            tvPoster: tvSeries.poster_url,
            tvRating: tvSeries.rating,
            seasons,
            selectedSeasonId: null,
            selectedSeason: null,
            selectedEpisode: null,
            episodes: []
        };

        const keyboard = seasons.map(s => ([{
            text: `📺 Season ${s.season_number}${s.name && s.name !== `Season ${s.season_number}` ? ` - ${s.name}` : ''}`,
            callback_data: `tv_season_${s.id}`
        }]));

        const caption =
            `📺 *${tvSeries.title}*\n\n` +
            `⭐ Rating: ${tvSeries.rating || 'N/A'}\n` +
            `🗂 Seasons: ${seasons.length}\n\n` +
            `${tvSeries.overview ? tvSeries.overview.substring(0, 150) + '...' : ''}\n\n` +
            `👇 Season එකක් තෝරන්න:`;

        const opts = { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } };

        if (tvSeries.poster_url) {
            await tgBot.sendPhoto(chatId, tvSeries.poster_url, { caption, ...opts });
        } else {
            await tgBot.sendMessage(chatId, caption, opts);
        }

    } catch (err) {
        console.error('❌ handleTVStart error:', err.message);
        tgBot.sendMessage(chatId, "❌ දෝෂයක් ඇතිවිය. නැවත try කරන්න.");
    }
}

// ═══════════════════════════════════════════════
// 🔘 CALLBACK QUERY HANDLER
// ═══════════════════════════════════════════════

tgBot.on('callback_query', async (callbackQuery) => {
    const message = callbackQuery.message;
    const chatId = message.chat.id;
    const data = callbackQuery.data;

    try {
        // ── MOVIE QUALITY ────────────────────────────────
        if (data.startsWith('movie_')) {
            const parts = data.split('_');
            const tmdbId = parts[1];
            const quality = parts[2];

            await tgBot.answerCallbackQuery(callbackQuery.id, {
                text: `🎬 ${quality === 'default' ? 'Full Quality' : quality + 'p'} සූදානම් කරමින்...`
            });
            return sendMovieFile(chatId, tmdbId, quality);
        }

        // ── TV: SEASON SELECTED ──────────────────────────
        if (data.startsWith('tv_season_')) {
            const seasonId = data.replace('tv_season_', '');
            const session = userSessions[chatId];

            if (!session) {
                return tgBot.answerCallbackQuery(callbackQuery.id, {
                    text: "⚠️ Session expired. නැවත /start try කරන්න.", show_alert: true
                });
            }

            await tgBot.answerCallbackQuery(callbackQuery.id, { text: "📋 Episodes load කරමින།..." });

            const episodes = await getTVEpisodes(seasonId);
            const selectedSeason = session.seasons.find(s => s.id === seasonId);

            if (episodes.length === 0) {
                return tgBot.sendMessage(chatId,
                    `❌ Season ${selectedSeason?.season_number || ''} - Episodes තවම add කර නැත.`
                );
            }

            session.selectedSeasonId = seasonId;
            session.selectedSeason = selectedSeason;
            session.episodes = episodes;

            const keyboard = episodes.map(ep => {
                const hasVideo = ep.tg_file_id_1080 || ep.tg_file_id_720 || ep.tg_file_id_360 ||
                    ep.video_url_1080 || ep.video_url_720 || ep.video_url_360 || ep.video_url;
                return [{
                    text: `${hasVideo ? '✅' : '❌'} E${ep.episode_number}: ${ep.title.substring(0, 25)}${ep.title.length > 25 ? '...' : ''}`,
                    callback_data: `tv_episode_${ep.id}`
                }];
            });
            keyboard.push([{ text: '🔙 Seasons වෙත ආපසු', callback_data: `tv_back_seasons_${session.tmdbId}` }]);

            return tgBot.sendMessage(chatId,
                `📺 *${session.tvTitle}* — Season ${selectedSeason?.season_number}\n\n` +
                `Episodes ${episodes.length}ක් ඇත.\n✅ = Available  ❌ = Not available\n\n` +
                `👇 Episode එකක් තෝරන්න:`,
                { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } }
            );
        }

        // ── TV: EPISODE SELECTED ─────────────────────────
        if (data.startsWith('tv_episode_')) {
            const episodeId = data.replace('tv_episode_', '');
            const session = userSessions[chatId];

            if (!session) {
                return tgBot.answerCallbackQuery(callbackQuery.id, {
                    text: "⚠️ Session expired. නැවත /start try කරන්න.", show_alert: true
                });
            }

            const episode = session.episodes.find(e => e.id === episodeId);
            if (!episode) {
                return tgBot.answerCallbackQuery(callbackQuery.id, {
                    text: "❌ Episode සොයාගත නොහැක.", show_alert: true
                });
            }

            await tgBot.answerCallbackQuery(callbackQuery.id, { text: `📋 ${episode.title}...` });
            session.selectedEpisode = episode;

            let keyboard = [];
            if (episode.tg_file_id_1080 || episode.video_url_1080)
                keyboard.push([{ text: '🔥 1080p - Full HD', callback_data: `tv_quality_${episodeId}_1080` }]);
            if (episode.tg_file_id_720 || episode.video_url_720)
                keyboard.push([{ text: '⚡ 720p - HD', callback_data: `tv_quality_${episodeId}_720` }]);
            if (episode.tg_file_id_360 || episode.video_url_360)
                keyboard.push([{ text: '📱 360p - SD', callback_data: `tv_quality_${episodeId}_360` }]);
            if (keyboard.length === 0 && episode.video_url)
                keyboard.push([{ text: '🎬 Download', callback_data: `tv_quality_${episodeId}_default` }]);

            keyboard.push([{ text: '🔙 Episodes වෙත ආපසු', callback_data: `tv_back_episodes_${session.selectedSeasonId}` }]);

            if (keyboard.length <= 1) {
                return tgBot.sendMessage(chatId,
                    `❌ *E${episode.episode_number}: ${episode.title}*\n\nVideo files තවම upload කර නැත.`,
                    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } }
                );
            }

            return tgBot.sendMessage(chatId,
                `📺 *${session.tvTitle}*\n` +
                `📂 Season ${session.selectedSeason?.season_number} › E${episode.episode_number}\n\n` +
                `🎬 *${episode.title}*\n` +
                `${episode.duration ? `⏱ ${episode.duration} mins\n` : ''}` +
                `${episode.overview ? episode.overview.substring(0, 150) + '...\n' : ''}\n` +
                `👇 Quality එක තෝරන්න:`,
                { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } }
            );
        }

        // ── TV: QUALITY SELECTED ─────────────────────────
        if (data.startsWith('tv_quality_')) {
            const withoutPrefix = data.replace('tv_quality_', '');
            const lastUnderscore = withoutPrefix.lastIndexOf('_');
            const episodeId = withoutPrefix.substring(0, lastUnderscore);
            const quality = withoutPrefix.substring(lastUnderscore + 1);

            const session = userSessions[chatId];
            const episode = session?.selectedEpisode;

            if (!episode) {
                return tgBot.answerCallbackQuery(callbackQuery.id, {
                    text: "❌ Session expired. නැවත /start try කරන්න.", show_alert: true
                });
            }

            await tgBot.answerCallbackQuery(callbackQuery.id, {
                text: `📥 ${quality === 'default' ? 'Full Quality' : quality + 'p'} සූදානම් කරමින்...`
            });
            return sendTVEpisodeFile(chatId, episode, quality, session);
        }

        // ── TV: BACK TO SEASONS ──────────────────────────
        if (data.startsWith('tv_back_seasons_')) {
            const tmdbId = data.replace('tv_back_seasons_', '');
            await tgBot.answerCallbackQuery(callbackQuery.id, { text: "🔙 Seasons..." });
            return handleTVStart(chatId, `tv_${tmdbId}`);
        }

        // ── TV: BACK TO EPISODES ─────────────────────────
        if (data.startsWith('tv_back_episodes_')) {
            const seasonId = data.replace('tv_back_episodes_', '');
            await tgBot.answerCallbackQuery(callbackQuery.id, { text: "🔙 Episodes..." });

            const session = userSessions[chatId];
            if (!session) return;

            const episodes = await getTVEpisodes(seasonId);
            const selectedSeason = session.seasons.find(s => s.id === seasonId);

            session.selectedSeasonId = seasonId;
            session.selectedSeason = selectedSeason;
            session.episodes = episodes;

            const keyboard = episodes.map(ep => {
                const hasVideo = ep.tg_file_id_1080 || ep.tg_file_id_720 || ep.tg_file_id_360 ||
                    ep.video_url_1080 || ep.video_url_720 || ep.video_url_360 || ep.video_url;
                return [{
                    text: `${hasVideo ? '✅' : '❌'} E${ep.episode_number}: ${ep.title.substring(0, 25)}${ep.title.length > 25 ? '...' : ''}`,
                    callback_data: `tv_episode_${ep.id}`
                }];
            });
            keyboard.push([{ text: '🔙 Seasons වෙත ආපසු', callback_data: `tv_back_seasons_${session.tmdbId}` }]);

            return tgBot.sendMessage(chatId,
                `📺 *${session.tvTitle}* — Season ${selectedSeason?.season_number}\n\n👇 Episode එකක් තෝරන්න:`,
                { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } }
            );
        }

    } catch (err) {
        console.error('❌ callback_query error:', err.message);
        try { await tgBot.answerCallbackQuery(callbackQuery.id, { text: "❌ දෝෂයක් ඇතිවිය", show_alert: true }); } catch (_) {}
        tgBot.sendMessage(chatId, "❌ දෝෂයක් ඇතිවිය.\nකරුණාකර නැවත try කරන්න.");
    }
});

// ═══════════════════════════════════════════════
// 📤 FILE SENDERS
// ═══════════════════════════════════════════════

async function sendMovieFile(chatId, tmdbId, quality) {
    const movie = await findMovie(tmdbId);
    if (!movie) return tgBot.sendMessage(chatId, "❌ Movie සොයාගත නොහැක.");

    const fileId = movie[`tg_file_id_${quality}`];
    const fileUrl = quality === 'default' ? movie.video_url : movie[`video_url_${quality}`];
    const qualityLabel = quality === 'default' ? 'Full Quality' : `${quality}p`;

    const caption =
        `🎬 *${movie.title}* (${qualityLabel})\n\n` +
        `📥 Movie Potha වෙතින්\n` +
        `⭐ Rating: ${movie.rating || 'N/A'}\n` +
        `⏱ Duration: ${movie.duration ? movie.duration + ' mins' : 'N/A'}`;

    return sendFileOrUrl(chatId, fileId, fileUrl, caption, qualityLabel);
}

async function sendTVEpisodeFile(chatId, episode, quality, session) {
    const fileId = episode[`tg_file_id_${quality}`];
    const fileUrl = quality === 'default' ? episode.video_url : episode[`video_url_${quality}`];
    const qualityLabel = quality === 'default' ? 'Full Quality' : `${quality}p`;

    const caption =
        `📺 *${session.tvTitle}*\n` +
        `Season ${session.selectedSeason?.season_number} › E${episode.episode_number} (${qualityLabel})\n\n` +
        `🎬 *${episode.title}*\n` +
        `📥 Movie Potha වෙතින්\n` +
        `⭐ Rating: ${session.tvRating || 'N/A'}`;

    return sendFileOrUrl(chatId, fileId, fileUrl, caption, qualityLabel);
}

async function sendFileOrUrl(chatId, fileId, fileUrl, caption, qualityLabel) {
    if (fileId && fileId.trim() !== '') {
        await tgBot.sendVideo(chatId, fileId, {
            caption,
            parse_mode: 'Markdown',
            supports_streaming: true
        });
        console.log(`✅ Video sent via File ID (${qualityLabel})`);

    } else if (fileUrl && fileUrl.trim() !== '') {
        await tgBot.sendMessage(chatId,
            `${caption}\n\n📥 කරුණාකර පහත ලින්ක් එකෙන් බාගන්න:`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[{ text: `📥 Download ${qualityLabel}`, url: fileUrl }]]
                }
            }
        );
        console.log(`✅ URL sent (${qualityLabel})`);

    } else {
        await tgBot.sendMessage(chatId,
            `❌ ${qualityLabel} quality සඳහා file එක තවම upload කර නැත.\nවෙනත් quality එකක් try කරන්න.`
        );
        console.log(`❌ No file for ${qualityLabel}`);
    }
}

// ═══════════════════════════════════════════════
// 📋 FILE ID EXTRACTOR
// ═══════════════════════════════════════════════

tgBot.on('message', (msg) => {
    if (msg.text && msg.text.startsWith('/start')) return;

    const video = msg.video ||
        (msg.document?.mime_type?.includes('video') ? msg.document : null);

    if (video) {
        const fileSize = (video.file_size / (1024 * 1024)).toFixed(2);
        tgBot.sendMessage(msg.chat.id,
            `✅ *Video File ID ලැබුණා!*\n\n` +
            `📋 File ID:\n\`${video.file_id}\`\n\n` +
            `📦 Size: ${fileSize} MB\n` +
            `⏱ Duration: ${video.duration ? Math.floor(video.duration / 60) + ' mins' : 'N/A'}\n\n` +
            `💡 Admin Panel → Telegram File ID field එකට copy කරන්න.`,
            { parse_mode: 'Markdown' }
        );
        console.log(`📋 File ID extracted: ${video.file_id}`);
    }
});

// ═══════════════════════════════════════════════
// ⚠️ ERROR HANDLING
// ═══════════════════════════════════════════════

tgBot.on('polling_error', (error) => {
    console.error('❌ Polling error:', error.code, error.message);
});

process.on('unhandledRejection', (reason) => {
    console.error('❌ Unhandled Rejection:', reason);
});
