require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');

// 1. Supabase Client එක සෙට් කිරීම
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// 2. Telegram Bot සෙට් කිරීම
const tgBot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

console.log("✅ Telegram Movie Bot සාර්ථකව ක්‍රියාත්මක වේ...");

// =====================================================================
// පොදු Logic එක: Database එකෙන් මූවී එක සෙවීම
// =====================================================================
async function findMovie(tmdbId) {
    const { data, error } = await supabase
        .from('movies')
        .select('*')
        .eq('tmdb_id', tmdbId)
        .single();

    if (error || !data) return null;
    return data;
}

// =====================================================================
// Telegram Bot Handling 
// =====================================================================

// 1. සයිට් එකෙන් එන අයගේ මැසේජ් කියවීම (/start)
tgBot.onText(/\/start (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const tmdbId = match[1];

    try {
        const movie = await findMovie(tmdbId);

        if (!movie) {
            return tgBot.sendMessage(chatId, "❌ කණගාටුයි, මූවී එක සොයාගැනීමට නොහැක.");
        }

        // tg_file_id එක තියෙනවා නම් වීඩියෝ එකම යවනවා
        if (movie.tg_file_id && movie.tg_file_id.trim() !== '') {
            await tgBot.sendVideo(chatId, movie.tg_file_id, {
                caption: `🎥 *${movie.title}*\n\nMovie Potha වෙතින් උපසිරැසි සමඟින්.`,
                parse_mode: 'Markdown'
            });
        } 
        // tg_file_id එක නැත්නම් ලින්ක් එක යවනවා
        else {
            await tgBot.sendMessage(chatId, `🎥 *${movie.title}*\n\nකණගාටුයි, වීඩියෝ ෆයිල් එක තවම අප්ඩේට් කර නැහැ. කරුණාකර පහත ලින්ක් එකෙන් බලන්න:\n🔗 ${movie.video_url}`, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true // ලින්ක් එකේ ප්‍රිවීව් එකක් එන එක නවත්වනවා
            });
        }
    } catch (err) {
        console.error("Telegram Send Error:", err.response ? err.response.body : err.message);
        tgBot.sendMessage(chatId, "❌ පද්ධතියේ දෝෂයක්. කරුණාකර පසුව උත්සාහ කරන්න.");
    }
});

// 2. Helper Logic (ඔයා වීඩියෝ එකක් එව්වම ඒකේ File ID එක දෙනවා)
tgBot.on('message', (msg) => {
    // /start කමාන්ඩ් වලට මේක වැඩ නොකරන්න
    if (msg.text && msg.text.startsWith('/start')) return;

    const chatId = msg.chat.id;
    const video = msg.video || (msg.document && msg.document.mime_type && msg.document.mime_type.includes('video') ? msg.document : null);

    if (video) {
        tgBot.sendMessage(chatId, `✅ මේ Main Bot ගේ File ID එක: \n\n\`${video.file_id}\``, { parse_mode: 'Markdown' });
    }
});