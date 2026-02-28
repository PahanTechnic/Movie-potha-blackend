const TelegramBot = require('node-telegram-bot-api');

// BotFather ගෙන් ලැබුණු Token එක මෙතනට දාන්න
const token = '8696935780:AAF9jC_OBWMVHtRcFioxB8hUsKwwlT16afs'; 
const bot = new TelegramBot(token, {polling: true});

console.log("Helper Bot ක්‍රියාත්මකයි... මට වීඩියෝ එකක් එවන්න.");

bot.on('message', (msg) => {
    const chatId = msg.chat.id;

    // වීඩියෝ එකක් හෝ වීඩියෝවක් සහිත ඩොකියුමන්ට් එකක් දැයි බලයි
    const video = msg.video || (msg.document && msg.document.mime_type.includes('video') ? msg.document : null);

    if (video) {
        const fileId = video.file_id;
        bot.sendMessage(chatId, `✅ මේකේ File ID එක මෙන්න: \n\n\`${fileId}\``, {parse_mode: 'Markdown'});
    } else {
        bot.sendMessage(chatId, " මචන්, මට වීඩියෝ ෆයිල් එකක්එවන්න (Forward කරන්න).");
    }
});