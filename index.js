require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const tgBot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

console.log("✅ Telegram Movie Bot සාර්ථකව ක්‍රියාත්මක වේ...");

// ✅ Movie එක සොයාගන්න වැඩිදියුණු කළ function
async function findMovie(tmdbId) {
    try {
        console.log(`🔍 Searching for TMDB ID: ${tmdbId}`);
        
        // Convert to integer to match database
        const numericId = parseInt(tmdbId);
        
        const { data, error } = await supabase
            .from('movies')
            .select('*')
            .eq('tmdb_id', numericId)
            .single();
        
        if (error) {
            console.error('❌ Database error:', error);
            return null;
        }
        
        if (!data) {
            console.log(`❌ Movie not found with TMDB ID: ${numericId}`);
            return null;
        }
        
        console.log(`✅ Movie found: ${data.title}`);
        return data;
    } catch (err) {
        console.error('❌ Error in findMovie:', err);
        return null;
    }
}

// 1. /start කමාන්ඩ් එකට Resolution තේරීමේ බටන් යැවීම
tgBot.onText(/\/start(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const param = match[1].trim(); // Remove whitespace
    
    // ✅ වැඩිදියුණු කළ parameter handling
    if (!param || param === '') {
        return tgBot.sendMessage(
            chatId, 
            "👋 Movie Potha Bot වෙත සාදරයෙන් පිළිගනිමු!\n\n" +
            "🎬 Movie එකක් බාගත කිරීමට:\n" +
            "1. Website එකෙන් movie එකක් තෝරන්න\n" +
            "2. 'Get on Telegram' බටන් එක click කරන්න\n" +
            "3. ඔබට අවශ්‍ය quality එක තෝරන්න\n\n" +
            "💡 Website: moviepotha.lk"
        );
    }

    const tmdbId = param;

    try {
        const movie = await findMovie(tmdbId);
        
        if (!movie) {
            return tgBot.sendMessage(
                chatId, 
                `❌ කණගාටුයි, මූවී එක සොයාගත නොහැක.\n\n` +
                `🔍 TMDB ID: ${tmdbId}\n\n` +
                `කරුණාකර website එකෙන් නැවත try කරන්න.`
            );
        }

        // ✅ බටන් සෑදීම (තිබෙන ඒවා පමණක් පෙන්වීමට)
        let keyboard = [];
        
        if (movie.tg_file_id_1080 || movie.video_url_1080) {
            keyboard.push([{ 
                text: '🎬 1080p (FHD) - Full HD', 
                callback_data: `${tmdbId}_1080` 
            }]);
        }
        
        if (movie.tg_file_id_720 || movie.video_url_720) {
            keyboard.push([{ 
                text: '🎬 720p (HD) - High Definition', 
                callback_data: `${tmdbId}_720` 
            }]);
        }
        
        if (movie.tg_file_id_360 || movie.video_url_360) {
            keyboard.push([{ 
                text: '🎬 360p (SD) - Standard', 
                callback_data: `${tmdbId}_360` 
            }]);
        }

        if (keyboard.length === 0) {
            return tgBot.sendMessage(
                chatId, 
                `❌ කණගාටුයි!\n\n` +
                `🎥 *${movie.title}*\n\n` +
                `මෙම මූවී එක සඳහා තවම video files upload කර නැත.\n` +
                `පසුව නැවත try කරන්න.`,
                { parse_mode: 'Markdown' }
            );
        }

        const opts = {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        };

        // ✅ Poster එක තිබුනොත් photo එකත් එක්ක යවනවා
        if (movie.poster_url) {
            await tgBot.sendPhoto(chatId, movie.poster_url, {
                caption: `🎥 *${movie.title}*${movie.release_date ? ` (${new Date(movie.release_date).getFullYear()})` : ''}\n\n` +
                         `⭐ Rating: ${movie.rating || 'N/A'}\n` +
                         `⏱ Duration: ${movie.duration ? movie.duration + ' mins' : 'N/A'}\n\n` +
                         `${movie.overview ? movie.overview.substring(0, 200) + '...' : ''}\n\n` +
                         `👇 කරුණාකර ඔබට අවශ්‍ය Resolution එක තෝරන්න:`,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });
        } else {
            await tgBot.sendMessage(
                chatId, 
                `🎥 *${movie.title}*${movie.release_date ? ` (${new Date(movie.release_date).getFullYear()})` : ''}\n\n` +
                `⭐ Rating: ${movie.rating || 'N/A'}\n` +
                `⏱ Duration: ${movie.duration ? movie.duration + ' mins' : 'N/A'}\n\n` +
                `Movie Potha වෙතින් උපසිරැසි සමඟින්.\n\n` +
                `👇 කරුණාකර ඔබට අවශ්‍ය Resolution එක තෝරන්න:`, 
                opts
            );
        }

    } catch (err) {
        console.error('❌ Error in /start handler:', err);
        tgBot.sendMessage(
            chatId, 
            "❌ පද්ධතියේ දෝෂයක් ඇතිවිය.\nකරුණාකර පසුව නැවත try කරන්න."
        );
    }
});

// 2. යූසර් බටන් එකක් ක්ලික් කළ විට ෆයිල් එක යැවීම
tgBot.on('callback_query', async (callbackQuery) => {
    const message = callbackQuery.message;
    const data = callbackQuery.data; // උදා: "748783_720"
    
    try {
        const [tmdbId, quality] = data.split('_'); // tmdbId සහ quality එක වෙන් කරගන්නවා

        const movie = await findMovie(tmdbId);
        
        if (!movie) {
            return tgBot.answerCallbackQuery(callbackQuery.id, { 
                text: "❌ Movie එක සොයාගත නොහැක", 
                show_alert: true 
            });
        }

        // අදාළ Quality එකට හරියන ID එක සහ URL එක තෝරාගැනීම
        let fileId = movie[`tg_file_id_${quality}`];
        let fileUrl = movie[`video_url_${quality}`];

        console.log(`📤 Sending ${quality}p for: ${movie.title}`);
        console.log(`File ID: ${fileId}`);
        console.log(`File URL: ${fileUrl}`);

        // Telegram Loading එක අයින් කිරීම
        await tgBot.answerCallbackQuery(callbackQuery.id, { 
            text: `${quality}p ෆයිල් එක යවමින් පවතී...` 
        });

        // ✅ File ID තිබුනාම video එක send කරනවා
        if (fileId && fileId.trim() !== '') {
            await tgBot.sendVideo(message.chat.id, fileId, {
                caption: `🎥 *${movie.title}* (${quality}p)\n\n` +
                         `📥 Movie Potha වෙතින්\n` +
                         `⭐ Rating: ${movie.rating || 'N/A'}\n` +
                         `⏱ Duration: ${movie.duration ? movie.duration + ' mins' : 'N/A'}`,
                parse_mode: 'Markdown',
                supports_streaming: true
            });
            
            console.log(`✅ Video sent successfully (${quality}p)`);
        } 
        // ✅ File ID නැත්නම් URL එක send කරනවා
        else if (fileUrl && fileUrl.trim() !== '') {
            await tgBot.sendMessage(message.chat.id, 
                `🎥 *${movie.title}* (${quality}p)\n\n` +
                `📥 කරුණාකර පහත ලින්ක් එකෙන් බාගන්න:\n\n` +
                `🔗 ${fileUrl}\n\n` +
                `⭐ Rating: ${movie.rating || 'N/A'}\n` +
                `⏱ Duration: ${movie.duration ? movie.duration + ' mins' : 'N/A'}`,
                {
                    parse_mode: 'Markdown',
                    disable_web_page_preview: false,
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '📥 Download', url: fileUrl }
                        ]]
                    }
                }
            );
            
            console.log(`✅ URL sent successfully (${quality}p)`);
        } 
        // ✅ දෙකම නැත්නම් error එකක්
        else {
            await tgBot.sendMessage(message.chat.id, 
                `❌ කණගාටුයි!\n\n` +
                `${quality}p quality එක සඳහා file එක තවම upload කර නැත.\n` +
                `වෙනත් quality එකක් try කරන්න.`
            );
            
            console.log(`❌ No file available for ${quality}p`);
        }
        
    } catch (err) {
        console.error('❌ Error in callback_query handler:', err);
        
        tgBot.answerCallbackQuery(callbackQuery.id, { 
            text: "❌ දෝෂයක් ඇතිවිය", 
            show_alert: true 
        });
        
        tgBot.sendMessage(message.chat.id, 
            "❌ ෆයිල් එක යැවීමේදී දෝෂයක් ඇතිවිය.\nකරුණාකර පසුව නැවත try කරන්න."
        );
    }
});

// ✅ Helper - Video එකක් forward කළාම File ID එක දෙනවා
tgBot.on('message', (msg) => {
    // /start command එක ignore කරනවා
    if (msg.text && msg.text.startsWith('/start')) return;
    
    // Video හෝ Document (video) එකක් තිබුනාම File ID එක send කරනවා
    const video = msg.video || (msg.document && msg.document.mime_type && msg.document.mime_type.includes('video') ? msg.document : null);
    
    if (video) {
        const fileSize = (video.file_size / (1024 * 1024)).toFixed(2); // MB එකකට convert කරනවා
        
        tgBot.sendMessage(msg.chat.id, 
            `✅ *Video File ID ලැබුණා!*\n\n` +
            `📋 File ID:\n\`${video.file_id}\`\n\n` +
            `📦 Size: ${fileSize} MB\n` +
            `⏱ Duration: ${video.duration ? Math.floor(video.duration / 60) + ' mins' : 'N/A'}\n\n` +
            `💡 මේ ID එක Admin Panel එකේ Telegram File ID field එකට copy කරන්න.`,
            { parse_mode: 'Markdown' }
        );
        
        console.log(`📋 File ID extracted: ${video.file_id}`);
    }
});

// ✅ Error handling
tgBot.on('polling_error', (error) => {
    console.error('❌ Polling error:', error);
});

console.log("🤖 Bot is ready and listening for messages...");