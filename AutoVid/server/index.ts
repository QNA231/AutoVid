import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';

dotenv.config();
// ffmpeg.setFfmpegPath("D:\\Quan\\autovid\\ffmpeg\\ffmpeg\\bin\\ffmpeg.exe");

const app = express();
app.use(cors());
app.use(express.json());
app.use('/output', express.static(path.join(__dirname, 'output')));

['temp', 'output'].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
});

// --- MENU "GIA VỊ" KỊCH BẢN ---
const STYLES = [
    "Kể lại dưới dạng nhật ký của nạn nhân.",
    "Kể dưới góc nhìn của người đang trốn trong tủ.",
    "Kể như bản tin thời sự cảnh báo.",
    "Kể theo phong cách Creepypasta dồn dập.",
    "Kể dưới dạng hội thoại tin nhắn cuối cùng."
];

const TWISTS = [
    "Kết thúc: Nhân vật chính nhận ra mình đã chết.",
    "Kết thúc: Thứ đáng sợ là con người bên cạnh.",
    "Kết thúc: Người xem video là mục tiêu tiếp theo.",
    "Kết thúc: Jumpscare bất ngờ.",
    "Kết thúc: Để ngỏ ám ảnh."
];

function getRandomItem(arr: string[]) {
    return arr[Math.floor(Math.random() * arr.length)];
}

// --- HÀM GỌI POLLINATIONS (Fix lỗi & Random) ---
async function generateTextWithPollinations(topic: string) {
    const randomStyle = getRandomItem(STYLES);
    const randomTwist = getRandomItem(TWISTS);
    const randomSeed = Math.floor(Math.random() * 1000000);

    console.log(`🎲 Style: "${randomStyle}"`);

    const prompt = `
    Bạn là tiểu thuyết gia kinh dị. Viết kịch bản về: "${topic}".
    YÊU CẦU:
    - Phong cách: ${randomStyle}
    - Twist: ${randomTwist}
    - Định dạng Output: JSON Raw (không markdown).
    - Format: {"narration": "Lời dẫn (Tiếng Việt, 500-1000 từ)", "visual_prompt": "Mô tả ảnh (Tiếng Anh)"}
    `;

    const url = `https://text.pollinations.ai/${encodeURIComponent(prompt)}?json=true&seed=${randomSeed}&model=openai`;

    const response = await axios.get(url);
    let data = response.data;
    
    if (typeof data === 'string') {
         const cleanJson = data.replace(/```json/g, '').replace(/```/g, '').trim();
         try {
            data = JSON.parse(cleanJson);
         } catch (e) {
            throw new Error("AI trả về sai định dạng");
         }
    }
    return data;
}

// --- TIỆN ÍCH ---
async function downloadFile(url: string, outputPath: string) {
    const writer = fs.createWriteStream(outputPath);
    const response = await axios({ url, method: 'GET', responseType: 'stream' });
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}

async function generateEdgeAudio(text: string, outputPath: string) {
    const tts = new MsEdgeTTS();
    const voices = ["vi-VN-NamMinhNeural", "vi-VN-HoaiMyNeural"];
    const randomVoice = voices[Math.floor(Math.random() * voices.length)];
    
    console.log(`🎤 Giọng đọc: ${randomVoice}`);
    await tts.setMetadata(randomVoice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    
    const result = await tts.toStream(text);
    const writer = fs.createWriteStream(outputPath);
    result.audioStream.pipe(writer);

    return new Promise((resolve, reject) => {
        writer.on('finish', () => resolve(outputPath));
        writer.on('error', reject);
    });
}

function getRandomVisualEffect() {
    const PRE = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1";
    const effects = [
        { name: "Classic_Zoom", filter: [PRE, `zoompan=z='min(zoom+0.0008,1.2)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=30`] },
        { name: "Heartbeat_Pulse", filter: [PRE, `zoompan=z='1.1+0.05*sin(on/30)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=30`] },
        { name: "Scanning_Pan", filter: [PRE, `zoompan=z=1.4:d=1:x='iw/2-(iw/zoom/2)+100*sin(on/50)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=30`] },
        { name: "Horror_Shake", filter: [PRE, `crop=w=1000:h=1840:x='40+random(1)*40':y='40+random(1)*40'`, `scale=1080:1920`, `eq=contrast=1.3:saturation=0.8`] },
        { name: "Ghost_Noise", filter: [PRE, `format=gray`, `noise=alls=15:allf=t+u`, `zoompan=z='min(zoom+0.0005,1.1)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=30`] }
    ];
    return effects[Math.floor(Math.random() * effects.length)];
}

// --- ROUTES ---
app.post('/api/generate', async (req: Request, res: Response): Promise<any> => {
    const { topic } = req.body;
    try {
        const data = await generateTextWithPollinations(topic);
        if (!data.narration || !data.visual_prompt) throw new Error("Thiếu dữ liệu");
        res.json({ script: data.narration, imagePrompt: data.visual_prompt });
    } catch (error: any) { 
        res.status(500).json({ error: 'Lỗi tạo nội dung: ' + error.message }); 
    }
});

// API RENDER (ĐÃ FIX LỖI NHẠC)
app.post('/api/render', async (req: Request, res: Response): Promise<any> => {
    const { script, imageUrl } = req.body;
    const timestamp = Date.now();
    const imagePath = path.join(__dirname, 'temp', `img_${timestamp}.jpg`);
    const voicePath = path.join(__dirname, 'temp', `voice_${timestamp}.mp3`);
    const bgMusicPath = path.join(__dirname, 'temp', `bg-music.mp3`);
    const videoPath = path.join(__dirname, 'output', `video_${timestamp}.mp4`);

    try {
        console.log('--- Render Fix Audio ---');
        await downloadFile(imageUrl, imagePath);
        await generateEdgeAudio(script, voicePath); 

        const hasMusic = fs.existsSync(bgMusicPath);
        const effect = getRandomVisualEffect();
        console.log(`🎬 Effect: ${effect.name}`);

        let command = ffmpeg();
        command.input(imagePath).loop();
        command.input(voicePath);
        
        if (hasMusic) {
            // FIX 1: Thêm inputOptions stream_loop -1 để nhạc lặp lại vô tận nếu nó ngắn hơn kịch bản
            command.input(bgMusicPath).inputOptions(['-stream_loop -1']); 
        }

        let complexFilter = [];
        complexFilter.push(`[0:v]${effect.filter.join(',')}[v_out]`);

        if (hasMusic) {
            complexFilter.push(`[1:a]atempo=1.5[voice_fast]`); 
            
            // FIX 2: Bỏ 'afade=t=out:st=10...' đi. Chỉ giữ lại chỉnh volume thôi.
            // Lệnh 'amix=duration=first' ở dưới sẽ tự động cắt nhạc khi giọng đọc kết thúc.
            complexFilter.push(`[2:a]volume=0.1[bg_adjusted]`);
            
            // duration=first: Video dài bằng thời lượng giọng đọc (first input)
            complexFilter.push(`[voice_fast][bg_adjusted]amix=inputs=2:duration=first:dropout_transition=2[a_out]`);
        } else {
            complexFilter.push(`[1:a]atempo=1.5[a_out]`);
        }

        command
            .complexFilter(complexFilter)
            .outputOptions(['-c:v libx264', '-preset ultrafast', '-tune stillimage', '-c:a aac', '-b:a 128k', '-pix_fmt yuv420p', '-r 30', '-shortest', '-map [v_out]', '-map [a_out]'])
            .save(videoPath)
            .on('end', () => {
                console.log('✅ Xong!');
                res.json({ videoUrl: `http://localhost:3001/output/video_${timestamp}.mp4` });
            })
            .on('error', (err) => {
                console.error("❌ Lỗi Render:", err.message);
                res.status(500).json({ error: err.message });
            });

    } catch (error: any) { 
        res.status(500).json({ error: error.message }); 
    }
});

const PORT = 3001;
app.listen(PORT, () => console.log(`Server Audio Fix chạy tại port ${PORT}`));