require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const tgBot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

console.log("✅ Telegram Movie Bot සාර්ථකව ක්‍රියාත්මක වේ...");

async function findMovie(tmdbId) {
    const { data, error } = await supabase.from('movies').select('*').eq('tmdb_id', tmdbId).single();
    if (error || !data) return null;
    return data;
}

// 1. /start කමාන්ඩ් එකට Resolution තේරීමේ බටන් යැවීම
tgBot.onText(/\/start (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const tmdbId = match[1];

    try {
        const movie = await findMovie(tmdbId);
        if (!movie) return tgBot.sendMessage(chatId, "❌ කණගාටුයි, මූවී එක සොයාගැනීමට නොහැක.");

        // බටන් සෑදීම (තිබෙන ඒවා පමණක් පෙන්වීමට)
        let keyboard = [];
        if (movie.tg_file_id_360 || movie.video_url_360) keyboard.push([{ text: '🎬 360p (SD)', callback_data: `${tmdbId}_360` }]);
        if (movie.tg_file_id_720 || movie.video_url_720) keyboard.push([{ text: '🎬 720p (HD)', callback_data: `${tmdbId}_720` }]);
        if (movie.tg_file_id_1080 || movie.video_url_1080) keyboard.push([{ text: '🎬 1080p (FHD)', callback_data: `${tmdbId}_1080` }]);

        if (keyboard.length === 0) {
            return tgBot.sendMessage(chatId, "❌ කණගාටුයි, මෙම මූවී එක සඳහා තවම ෆයිල්ස් අප්ඩේට් කර නැහැ.");
        }

        const opts = {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        };

        await tgBot.sendMessage(chatId, `🎥 *${movie.title}*\n\nMovie Potha වෙතින් උපසිරැසි සමඟින්.\n\n👇 කරුණාකර ඔබට අවශ්‍ය Resolution එක තෝරන්න:`, opts);

    } catch (err) {
        console.error(err);
        tgBot.sendMessage(chatId, "❌ පද්ධතියේ දෝෂයක්.");
    }
});

// 2. යූසර් බටන් එකක් ක්ලික් කළ විට ෆයිල් එක යැවීම
tgBot.on('callback_query', async (callbackQuery) => {
    const message = callbackQuery.message;
    const data = callbackQuery.data; // උදා: "748783_720"
    
    const [tmdbId, quality] = data.split('_'); // tmdbId සහ quality එක වෙන් කරගන්නවා

    try {
        const movie = await findMovie(tmdbId);
        if (!movie) return;

        // අදාළ Quality එකට හරියන ID එක සහ URL එක තෝරාගැනීම
        let fileId = movie[`tg_file_id_${quality}`];
        let fileUrl = movie[`video_url_${quality}`];

        // Telegram Loading එක අයින් කිරීම
        tgBot.answerCallbackQuery(callbackQuery.id, { text: `${quality}p ෆයිල් එක යවමින් පවතී...` });

        if (fileId && fileId.trim() !== '') {
            await tgBot.sendVideo(message.chat.id, fileId, {
                caption: `🎥 *${movie.title}* (${quality}p)\n\nMovie Potha වෙතින්.`,
                parse_mode: 'Markdown'
            });
        } else if (fileUrl) {
            await tgBot.sendMessage(message.chat.id, `🎥 *${movie.title}* (${quality}p)\n\nකරුණාකර පහත ලින්ක් එකෙන් බලන්න:\n🔗 ${fileUrl}`, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true
            });
        }
    } catch (err) {
        console.error(err);
    }
});

// Helper Logic
tgBot.on('message', (msg) => {
    if (msg.text && msg.text.startsWith('/start')) return;
    const video = msg.video || (msg.document && msg.document.mime_type && msg.document.mime_type.includes('video') ? msg.document : null);
    if (video) {
        tgBot.sendMessage(msg.chat.id, `✅ මේ Main Bot ගේ File ID එක: \n\n\`${video.file_id}\``, { parse_mode: 'Markdown' });
    }
});