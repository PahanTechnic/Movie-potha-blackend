require('dotenv').config();
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');

// 1. Supabase Client එක සෙට් කිරීම
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// 2. Telegram Bot සෙට් කිරීම
const tgBot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

// 3. WhatsApp Client එක සෙට් කිරීම (Edge බ්‍රවුසර් එක භාවිතයෙන්)
const waClient = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { 
        executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ] 
    }
});

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

// --- Google Drive Link එක Direct Download Link එකක් කරන Function එක ---
function getDirectDriveLink(url) {
    if (!url) return null;
    const match = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
        return `https://drive.google.com/uc?export=download&id=${match[1]}`;
    }
    return url;
}

// =====================================================================
// Telegram Bot Handling (Deep Linking & Helper)
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
                parse_mode: 'Markdown'
            });
        }
    } catch (err) {
        console.error("Telegram Send Error:", err.response ? err.response.body : err.message);
        tgBot.sendMessage(chatId, "❌ පද්ධතියේ දෝෂයක්. කරුණාකර පසුව උත්සාහ කරන්න.");
    }
});

// 2. Helper Logic (ඔයා වීඩියෝ එකක් එව්වම ඒකේ File ID එක දෙනවා)
tgBot.on('message', (msg) => {
    if (msg.text && msg.text.startsWith('/start')) return;

    const chatId = msg.chat.id;
    const video = msg.video || (msg.document && msg.document.mime_type && msg.document.mime_type.includes('video') ? msg.document : null);

    if (video) {
        tgBot.sendMessage(chatId, `✅ මේ Main Bot ගේ File ID එක: \n\n\`${video.file_id}\``, { parse_mode: 'Markdown' });
    }
});

// =====================================================================
// WhatsApp Bot Handling (Queue System එක සමග)
// =====================================================================

// --- Queue එක පාලනය කරන විචල්‍යයන් ---
let movieQueue = []; // ඉල්ලීම් එකතු කරන ලිස්ට් එක
let isProcessing = false; // මේ වෙලාවේ මූවී එකක් යවමින්ද ඉන්නේ කියලා බලන එක

// --- පෝලිම ක්‍රියාත්මක කරන Function එක ---
async function processQueue() {
    if (isProcessing || movieQueue.length === 0) return;

    isProcessing = true;
    const request = movieQueue.shift(); // පෝලිමේ ඉන්න පළවෙනියා ගන්නවා

    try {
        await waClient.sendMessage(request.chatId, `🎬 *${request.movie.title}*\n\nඔබගේ ෆයිල් එක දැන් යවමින් පවතී. ෆයිල් සයිස් එක අනුව මෙය ලැබීමට මිනිත්තු කිහිපයක් ගතවනු ඇත. කරුණාකර රැඳී සිටින්න...`);
        
        const media = await MessageMedia.fromUrl(request.directUrl, { 
            unsafeMime: true,
            filename: `${request.movie.slug}.mp4`
        }); 

        await waClient.sendMessage(request.chatId, media, { 
            caption: `🎬 *${request.movie.title}* \n\nMovie Potha වෙතින්.`,
            sendMediaAsDocument: true 
        });

        await waClient.sendMessage(request.chatId, "✅ මූවී එක සාර්ථකව යවා අවසන්! Movie Potha සමඟ රැඳී සිටියාට ස්තූතියි.");
        
    } catch (err) {
        console.error("WhatsApp Send Error:", err.message);
        // Error එකක් ආවොත් (හෝ Google Drive Limit පැන්නොත්) ලින්ක් එක දෙනවා
        await waClient.sendMessage(request.chatId, `❌ කණගාටුයි, මූවී ෆයිල් එක විශාල වැඩි බැවින් එය කෙලින්ම යැවීමට නොහැක.\n\nකරුණාකර පහත ලින්ක් එකෙන් ඩවුන්ලොඩ් කරගන්න: \n🔗 ${request.movie.download_url || request.movie.video_url}`);
    } finally {
        isProcessing = false;
        processQueue(); // ඊළඟ කෙනාට යවන්න Call කරනවා
    }
}

// --- WhatsApp මැසේජ් කියවීම ---
waClient.on('qr', (qr) => qrcode.generate(qr, { small: true }));
waClient.on('ready', () => console.log('✅ WhatsApp Bot එක ලෑස්තියි!'));

waClient.on('message', async (msg) => {
    if (msg.body.startsWith('GET_MOVIE_')) {
        const tmdbId = msg.body.replace('GET_MOVIE_', '');
        const movie = await findMovie(tmdbId);

        if (movie && movie.video_url) {
            
            // 1. පෝලිමට දානවා
            movieQueue.push({
                chatId: msg.from,
                movie: movie,
                directUrl: getDirectDriveLink(movie.video_url)
            });

            // 2. පෝලිමේ තත්ත්වය යූසර්ට කියනවා
            const position = movieQueue.length;
            
            if (position === 1 && !isProcessing) {
                msg.reply(`✅ ඔබගේ ඉල්ලීම ලැබුණා. දැන්ම ෆයිල් එක යැවීම ආරම්භ කරනවා...`);
            } else {
                msg.reply(`⏳ ඔබගේ ඉල්ලීම පෝලිමේ (Queue) ඇත. ඔබට පෙර තව ${position - 1} දෙනෙක් සිටී. ඔබේ වාරය පැමිණි විගස මූවී එක ලැබෙනු ඇත...`);
            }

            // 3. පෝලිම රන් කරනවා
            processQueue();
        }
    }
});

// අන්තිමට මේක අනිවාර්යයෙන් තියෙන්න ඕනේ
waClient.initialize();