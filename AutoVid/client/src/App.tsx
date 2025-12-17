import { useState } from 'react';
import axios from 'axios';
import './App.css';

function App() {
  const [topic, setTopic] = useState('');
  const [data, setData] = useState<{ script: string, imagePrompt: string } | null>(null);
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
      setData(res.data);
    } catch (err) {
      alert('Lỗi tạo nội dung');
    } finally {
      setLoading(false);
    }
  };

  const getImageUrl = (prompt: string) => {
    const encodedPrompt = encodeURIComponent(prompt + " cinematic horror, 8k, dark masterpiece");
    return `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1080&height=1920&nologo=true&seed=${Math.floor(Math.random()*1000)}`;
  };

  const handleRender = async () => {
    if (!data) return;
    setRendering(true);
    try {
      // Logic: Lấy ảnh hiện tại đang hiển thị để render
      // (Vì mỗi lần gọi getImageUrl nó random seed khác nhau, nên ở đây ta gọi lại 1 lần cố định để gửi xuống server)
      const fixedImageUrl = getImageUrl(data.imagePrompt); 
      
      const res = await axios.post('http://localhost:3001/api/render', {
        script: data.script, // Gửi kịch bản "sạch" (chỉ có lời thoại)
        imageUrl: fixedImageUrl
      });
      setVideoUrl(res.data.videoUrl);
    } catch (err) {
      alert('Lỗi dựng video');
    } finally {
      setRendering(false);
    }
  };

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h1 style={{color: '#fe2c55'}}>🎬 Video v2</h1>
      
      <div style={{ display: 'flex', gap: '10px', marginBottom: '30px' }}>
        <input 
          value={topic} 
          onChange={e => setTopic(e.target.value)} 
          placeholder="Nhập chủ đề kinh dị..."
          style={{ flex: 1, padding: '15px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '16px' }}
        />
        <button 
          onClick={handleGenerate} 
          disabled={loading} 
          style={{ padding: '0 30px', background: '#fe2c55', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}
        >
          {loading ? '🔮 Đang triệu hồi AI...' : 'TẠO KỊCH BẢN'}
        </button>
      </div>

      {data && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
          
          {/* CỘT TRÁI: KỊCH BẢN & SETTING */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ background: '#f8f8f8', padding: '20px', borderRadius: '12px', border: '1px solid #eee' }}>
              <h3 style={{marginTop: 0}}>🎙️ Lời Dẫn (Sẽ đọc):</h3>
              <textarea 
                value={data.script} 
                onChange={(e) => setData({...data, script: e.target.value})}
                style={{ width: '100%', height: '150px', padding: '10px', borderRadius: '8px', border: '1px solid #ccc', lineHeight: '1.5' }}
              />
              <p style={{fontSize: '12px', color: '#666'}}>*Đây là nội dung sạch, không chứa mô tả cảnh "Scene:..."</p>
            </div>

            <div style={{ background: '#eef2ff', padding: '20px', borderRadius: '12px', border: '1px solid #c7d2fe' }}>
              <h3 style={{marginTop: 0, color: '#3730a3'}}>🎨 Prompt Vẽ Ảnh (Ẩn):</h3>
              <p style={{fontSize: '13px', fontStyle: 'italic', color: '#4338ca'}}>{data.imagePrompt}</p>
            </div>
          </div>

          {/* CỘT PHẢI: PREVIEW & RENDER */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ position: 'relative', borderRadius: '12px', overflow: 'hidden', border: '1px solid #ddd', minHeight: '300px', background: '#000' }}>
              {!videoUrl ? (
                <img src={getImageUrl(data.imagePrompt)} alt="AI Art" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.8 }} />
              ) : (
                <video controls autoPlay src={videoUrl} style={{ width: '100%', height: '100%' }} />
              )}
              
              {!videoUrl && (
                <div style={{ position: 'absolute', bottom: '20px', left: '0', width: '100%', textAlign: 'center' }}>
                   <button 
                    onClick={handleRender} 
                    disabled={rendering}
                    style={{ 
                      padding: '15px 40px', 
                      background: 'white', 
                      color: 'black', 
                      border: 'none', 
                      borderRadius: '30px', 
                      cursor: 'pointer', 
                      fontWeight: 'bold',
                      boxShadow: '0 4px 15px rgba(0,0,0,0.3)'
                    }}
                  >
                    {rendering ? '⚙️ Đang Render...' : '🎥 DỰNG VIDEO NGAY'}
                  </button>
                </div>
              )}
            </div>
            
            {videoUrl && (
              <a 
                href={videoUrl} 
                download="tiktok_video.mp4"
                style={{ textAlign: 'center', display: 'block', padding: '15px', background: '#4CAF50', color: 'white', textDecoration: 'none', borderRadius: '8px', fontWeight: 'bold' }}
              >
                ⬇️ Tải Video Về Máy
              </a>
            )}
          </div>

        </div>
      )}
    </div>
  );
}

export default App;