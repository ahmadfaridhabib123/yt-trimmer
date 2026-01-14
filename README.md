<h1 align="center">🎬 Bibboy YTrimmer v2.1</h1>
<p align="center">
<strong>Download and trim sections of YouTube videos with a modern web UI</strong>
</p>

<p align="center">
<img src="https://i.gyazo.com/47d07ad7f425ccd747b4f6c3fb483e51.gif" alt="Demo">
</p>

---

## ✨ Features

- 🎥 **Video Trimming** - Download specific sections of YouTube videos
- 🎵 **Audio Extraction** - Convert to MP3 format
- 📊 **Real-time Progress** - SSE-powered live updates
- 🔒 **Security** - URL sanitization, rate limiting, input validation
- 💾 **Disk Space Check** - Prevents server from running out of space
- 📝 **Proper Logging** - Winston-based structured logging
- 🌐 **Modern UI** - Beautiful, responsive web interface
- 🖥️ **CLI Mode** - Command-line interface for automation

---

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) v16+
- [ffmpeg](https://ffmpeg.org/) installed and in PATH
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) installed and in PATH

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/yt-trimmer.git
cd yt-trimmer

# Install dependencies
npm install

# Copy environment config
cp .env.example .env

# Start the server
npm start
```

### Open in Browser

Navigate to [http://localhost:3000](http://localhost:3000)

---

## 📖 Usage

### Web Interface

1. Start the server with `npm start`
2. Open [http://localhost:3000](http://localhost:3000) in your browser
3. Paste a YouTube URL
4. Set start and end times
5. Choose format (MP4 or MP3) and quality
6. Click "Download & Trim"

### CLI - Single Cut

```bash
npm run trim
```

You will be prompted for:
- YouTube URL
- Start time (format: `HH:mm:ss` or `mm:ss`)
- End time
- Output filename

### CLI - Multiple Cuts

1. Edit `src/actions/multiple-parts.js`:

```javascript
const data = {
  url: 'https://www.youtube.com/watch?v=VIDEO_ID',
  intervals: [
    ['00:01:19', '00:01:40'],
    ['00:04:30', '00:05:00']
  ],
  concat: true // Combine into single file
}
```

2. Run:

```bash
npm run trimall
```

---

## ⚙️ Configuration

All configuration is done via environment variables in `.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `NODE_ENV` | development | Environment mode |
| `RATE_LIMIT_WINDOW` | 60000 | Rate limit window (ms) |
| `RATE_LIMIT_MAX` | 10 | Max requests per window |
| `MAX_DURATION_SECONDS` | 600 | Max video duration (10 min) |
| `MIN_DISK_SPACE_MB` | 1024 | Min free disk space |
| `AUTO_DELETE_AFTER_DOWNLOAD` | true | Auto-cleanup files |

---

## 🔒 Security Features

- ✅ **URL Sanitization** - Only valid YouTube URLs accepted
- ✅ **Input Validation** - All inputs validated and sanitized
- ✅ **Rate Limiting** - Prevents abuse (10 requests/minute)
- ✅ **Max Duration** - 10 minute limit per download
- ✅ **Disk Space Check** - Prevents server crashes
- ✅ **Shell Injection Protection** - No shell metacharacters allowed
- ✅ **Filename Sanitization** - Safe output filenames

---

## 📁 Project Structure

```
yt-trimmer/
├── public/             # Frontend files
│   ├── index.html      # Main UI
│   ├── main.js         # Frontend JavaScript
│   └── style.css       # Tailwind CSS output
├── src/
│   ├── actions/        # CLI actions
│   ├── config/         # Configuration module
│   ├── robots/         # Core utilities
│   ├── server/         # Express server
│   └── utils/          # Utilities (logger, validators)
├── logs/               # Log files (gitignored)
├── .env                # Environment config (gitignored)
├── .env.example        # Example config
└── package.json
```

---

## 🛠️ API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | Web interface |
| `GET` | `/video-info?url=` | Get video metadata |
| `POST` | `/trim` | Start trim job |
| `GET` | `/progress/:taskId` | SSE progress stream |
| `GET` | `/download/:filename` | Download result |
| `GET` | `/health` | Health check |

---

## 📜 Scripts

```bash
npm start      # Start production server
npm run dev    # Start development server
npm run trim   # CLI: single video trim
npm run trimall # CLI: multiple video trims
npm run clean  # Clean temp files
npm run build  # Build Tailwind CSS
```

---

## 🧪 Health Check

```bash
# Check server status
curl http://localhost:3000/health
```

---

## 📝 Changelog

### v2.1.0
- ✨ Added environment configuration (.env)
- ✨ Added Winston logging with file rotation
- ✨ Added disk space checking
- ✨ Added input length validation
- ✨ Added download history (localStorage)
- ✨ Added periodic cleanup of temp files
- 🔒 Improved security with centralized validators
- 📁 Better project structure

### v2.0.0
- ✨ Modern web UI with Tailwind CSS
- ✨ Real-time progress with SSE
- ✨ Video preview with metadata
- ✨ MP4 and MP3 support
- ✨ Quality selection

---

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

---

## 🙏 Credits

- Original project by [Mayk Brito](https://github.com/maykbrito)
- Powered by [yt-dlp](https://github.com/yt-dlp/yt-dlp) and [ffmpeg](https://ffmpeg.org/)
