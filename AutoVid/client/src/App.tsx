import { useState } from 'react';
import axios from 'axios';
import './App.css';

// 1. Cập nhật kiểu dữ liệu mới (Khớp với Server All-in-One)
interface VideoData {
  narration: string;
  visual_prompts: string[]; // Đây là mảng chuỗi (3 prompt)
}

function App() {
  const [topic, setTopic] = useState('');
  const [data, setData] = useState<VideoData | null>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [rendering, setRendering] = useState(false);

  const handleGenerate = async () => {
    if (!topic) return;
    setLoading(true);
    setVideoUrl('');
    setData(null);
    try {
      const res = await axios.post('http://localhost:3001/api/generate', { topic });
      // Server trả về { narration, visual_prompts }
      setData(res.data); 
    } catch (err) {
      alert('Lỗi tạo nội dung: Có thể do Server quá tải hoặc AI chưa trả về JSON đúng.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Hàm lấy link ảnh preview (Chỉ lấy ảnh đầu tiên để xem trước)
  const getPreviewImageUrl = (prompts: string[]) => {
    if (!prompts || prompts.length === 0) return '';
    const firstPrompt = prompts[0] + " cinematic horror, 8k, dark masterpiece";
    return `https://image.pollinations.ai/prompt/${encodeURIComponent(firstPrompt)}?width=1080&height=1920&nologo=true&seed=${Math.floor(Math.random()*1000)}`;
  };

  const handleRender = async () => {
    if (!data) return;
    setRendering(true);
    try {
      // Gửi đúng cấu trúc mà Server All-in-One yêu cầu
      const res = await axios.post('http://localhost:3001/api/render', {
        script: data.narration,      // Lấy từ narration
        visual_prompts: data.visual_prompts // Gửi cả mảng 3 prompt
      });
      setVideoUrl(res.data.videoUrl);
    } catch (err) {
      alert('Lỗi dựng video. Kiểm tra console server để biết chi tiết.');
    } finally {
      setRendering(false);
    }
  };

  return (
    <div style={{ margin: '0 auto', padding: '20px', fontFamily: 'Arial, sans-serif', color: 'white' }}>
      <h1 style={{color: '#fe2c55', textAlign: 'center'}}>🎬 Auto V3 (All-in-One)</h1>
      
      <div style={{ display: 'flex', gap: '10px', marginBottom: '30px', justifyContent: 'center' }}>
        <input 
          value={topic} 
          onChange={e => setTopic(e.target.value)} 
          placeholder="Nhập chủ đề kinh dị (VD: Bệnh viện bỏ hoang)..."
          style={{ width: '60%', padding: '15px', borderRadius: '30px', border: 'none', fontSize: '16px', outline: 'none', backgroundColor: '#2d2d2d', color: 'white' }}
        />
        <button 
          onClick={handleGenerate} 
          disabled={loading} 
          style={{ padding: '15px 30px', background: '#fe2c55', color: 'white', border: 'none', borderRadius: '30px', cursor: 'pointer', fontWeight: 'bold', fontSize: '16px' }}
        >
          {loading ? '🔮 Đang triệu hồi...' : 'TẠO KỊCH BẢN'}
        </button>
      </div>

      {data && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px' }}>
          
          {/* CỘT TRÁI: KỊCH BẢN & PROMPTS */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            
            {/* Phần Lời Dẫn */}
            <div style={{ background: '#1e1e1e', padding: '20px', borderRadius: '15px', border: '1px solid #333' }}>
              <h3 style={{marginTop: 0, color: '#fe2c55'}}>🎙️ Kịch Bản (Narration):</h3>
              <textarea 
                value={data.narration} 
                onChange={(e) => setData({...data, narration: e.target.value})}
                style={{ width: '100%', maxWidth: '92%', height: '200px', padding: '15px', borderRadius: '10px', border: '1px solid #444', backgroundColor: '#2d2d2d', color: '#ddd', lineHeight: '1.6', fontSize: '14px', resize: 'vertical' }}
              />
              <p style={{fontSize: '12px', color: '#888', marginTop: '10px'}}>*Bạn có thể chỉnh sửa lời dẫn ở trên trước khi Render.</p>
            </div>

            {/* Phần Danh sách 3 Prompt Ảnh */}
            <div style={{ background: '#1e1e1e', padding: '20px', borderRadius: '15px', border: '1px solid #333' }}>
              <h3 style={{marginTop: 0, color: '#4facfe'}}>🖼️ 3 Cảnh Phim (Visual Prompts):</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {data.visual_prompts.map((prompt, index) => (
                    <div key={index} style={{ background: '#2d2d2d', padding: '10px', borderRadius: '8px', borderLeft: '4px solid #4facfe' }}>
                        <strong style={{color: '#4facfe', display: 'block', marginBottom: '5px'}}>Cảnh {index + 1}:</strong>
                        <span style={{fontSize: '13px', color: '#ccc', fontStyle: 'italic'}}>{prompt}</span>
                    </div>
                ))}
              </div>
            </div>
          </div>

          {/* CỘT PHẢI: PREVIEW & RENDER */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ position: 'relative', borderRadius: '15px', overflow: 'hidden', border: '1px solid #444', height: '600px', background: '#000', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
              {!videoUrl ? (
                <>
                    <img 
                        src={getPreviewImageUrl(data.visual_prompts)} 
                        alt="Preview Art" 
                        style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.7 }} 
                    />
                    <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', width: '80%' }}>
                        <h2 style={{textShadow: '0 2px 10px black'}}>Sẵn Sàng Dựng Phim</h2>
                        <p style={{textShadow: '0 2px 5px black'}}>Hệ thống sẽ tạo 3 ảnh, lồng tiếng, ghép nhạc và phụ đề.</p>
                    </div>
                </>
              ) : (
                <video controls autoPlay src={videoUrl} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              )}
              
              {!videoUrl && (
                <div style={{ position: 'absolute', bottom: '30px', left: '0', width: '100%', textAlign: 'center' }}>
                   <button 
                    onClick={handleRender} 
                    disabled={rendering}
                    style={{ 
                      padding: '18px 50px', 
                      background: rendering ? '#555' : 'linear-gradient(45deg, #fe2c55, #ff0055)', 
                      color: 'white', 
                      border: 'none', 
                      borderRadius: '50px', 
                      cursor: rendering ? 'not-allowed' : 'pointer', 
                      fontWeight: 'bold',
                      fontSize: '18px',
                      boxShadow: '0 4px 20px rgba(254, 44, 85, 0.6)',
                      transition: 'transform 0.2s'
                    }}
                  >
                    {rendering ? '⚙️ ĐANG XỬ LÝ (Mất 1-2 phút)...' : '🎥 DỰNG VIDEO NGAY'}
                  </button>
                </div>
              )}
            </div>
            
            {videoUrl && (
              <a 
                href={videoUrl} 
                download={`tiktok_horror_${Date.now()}.mp4`}
                style={{ textAlign: 'center', display: 'block', padding: '15px', background: '#25D366', color: 'white', textDecoration: 'none', borderRadius: '10px', fontWeight: 'bold', fontSize: '16px' }}
              >
                ⬇️ TẢI VIDEO VỀ MÁY
              </a>
            )}
          </div>

        </div>
      )}
    </div>
  );
}

export default App;