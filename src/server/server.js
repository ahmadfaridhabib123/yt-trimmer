/**
 * YT-Trimmer Server v2.1
 * Improved version with proper logging, config, and utilities
 */

const express = require('express');
const path = require('path');
const { spawn, exec } = require('child_process');
const util = require('util');
const cors = require('cors');
const fs = require('fs');

// Load configuration and utilities
const config = require('../config');
const logger = require('../utils/logger');
const validators = require('../utils/validators');
const { diskSpaceMiddleware, checkAvailableSpace } = require('../utils/diskChecker');

const execPromise = util.promisify(exec);
const app = express();

// Store for SSE connections and task progress
const progressStreams = new Map();
const taskProgress = new Map();

// Rate limiting - simple in-memory store
const rateLimitStore = new Map();

// ===========================================
// MIDDLEWARE
// ===========================================

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Request logging middleware
app.use((req, res, next) => {
  logger.debug(`${req.method} ${req.path}`, { ip: req.ip });
  next();
});

// Rate limiter middleware
function rateLimiter(req, res, next) {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  const now = Date.now();

  if (!rateLimitStore.has(ip)) {
    rateLimitStore.set(ip, { count: 1, startTime: now });
    return next();
  }

  const record = rateLimitStore.get(ip);

  if (now - record.startTime > config.rateLimit.windowMs) {
    rateLimitStore.set(ip, { count: 1, startTime: now });
    return next();
  }

  if (record.count >= config.rateLimit.max) {
    logger.warn('Rate limit exceeded', { ip, count: record.count });
    return res.status(429).json({
      success: false,
      message: 'Terlalu banyak request. Silakan tunggu 1 menit.'
    });
  }

  record.count++;
  next();
}

// Cleanup old rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of rateLimitStore.entries()) {
    if (now - record.startTime > config.rateLimit.windowMs) {
      rateLimitStore.delete(ip);
    }
  }
}, 60000);

// ===========================================
// SERVE STATIC FILES
// ===========================================

app.use(express.static(path.join(__dirname, config.paths.public)));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, config.paths.public, 'index.html'));
});

// ===========================================
// GET VIDEO INFO (for preview)
// ===========================================

app.get('/video-info', rateLimiter, async (req, res) => {
  const { url } = req.query;

  const sanitizedUrl = validators.sanitizeYouTubeUrl(url);
  if (!sanitizedUrl) {
    return res.status(400).json({
      success: false,
      message: 'URL YouTube tidak valid'
    });
  }

  const videoId = validators.extractVideoId(sanitizedUrl);

  try {
    logger.info('Fetching video info', { url: sanitizedUrl, videoId });

    // Get video info using yt-dlp
    const cmd = `yt-dlp --dump-json --no-download "${sanitizedUrl}"`;
    const { stdout } = await execPromise(cmd, {
      maxBuffer: 1024 * 1024 * 5,
      timeout: 30000
    });

    const info = JSON.parse(stdout);

    res.json({
      success: true,
      data: {
        id: videoId,
        title: info.title || 'Unknown Title',
        duration: info.duration || 0,
        durationFormatted: info.duration_string || '00:00',
        thumbnail: info.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        uploader: info.uploader || 'Unknown',
        viewCount: info.view_count || 0,
        formats: {
          video: config.video.supportedQualities,
          audio: ['mp3']
        }
      }
    });

  } catch (error) {
    logger.error('Error fetching video info', { error: error.message, url: sanitizedUrl });

    // Fallback - return basic info using video ID
    res.json({
      success: true,
      data: {
        id: videoId,
        title: 'Video YouTube',
        duration: 0,
        durationFormatted: '??:??',
        thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        uploader: 'Unknown',
        viewCount: 0,
        formats: {
          video: config.video.supportedQualities,
          audio: ['mp3']
        }
      }
    });
  }
});

// ===========================================
// SSE PROGRESS ENDPOINT
// ===========================================

app.get('/progress/:taskId', (req, res) => {
  const { taskId } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ status: 'connected', progress: 0 })}\n\n`);

  // Store the response object
  progressStreams.set(taskId, res);

  logger.debug('SSE connection established', { taskId });

  // Cleanup on close
  req.on('close', () => {
    progressStreams.delete(taskId);
    logger.debug('SSE connection closed', { taskId });
  });
});

/**
 * Send progress update to SSE client
 */
function sendProgress(taskId, data) {
  const stream = progressStreams.get(taskId);
  if (stream) {
    stream.write(`data: ${JSON.stringify(data)}\n\n`);
  }
  taskProgress.set(taskId, data);
  logger.task(taskId, data.status, data.message || '', { progress: data.progress });
}

// ===========================================
// TRIM ENDPOINT (Main functionality)
// ===========================================

app.post('/trim', rateLimiter, diskSpaceMiddleware, async (req, res) => {
  logger.info('Received trim request', { body: { ...req.body, url: '[REDACTED]' } });

  // Validate all inputs
  const validation = validators.validateTrimRequest(req.body);

  if (!validation.isValid) {
    logger.warn('Validation failed', { errors: validation.errors });
    return res.status(400).json({
      success: false,
      message: validation.errors.join('. ')
    });
  }

  const { url, start, end, filename, format, quality } = validation.data;

  // Calculate duration
  const startSec = validators.timeToSeconds(start);
  const endSec = validators.timeToSeconds(end);
  const duration = endSec - startSec;

  const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const tempFile = path.join(__dirname, `../../temp_${taskId}.${format === 'mp3' ? 'mp3' : 'mp4'}`);
  const extension = format === 'mp3' ? 'mp3' : 'mp4';
  const finalFile = path.join(__dirname, `../../${filename}.${extension}`);
  const outputFilename = `${filename}.${extension}`;

  logger.info('Processing trim request', {
    taskId,
    start,
    end,
    duration,
    format,
    quality,
    filename: outputFilename
  });

  // Send initial response with taskId
  res.json({
    success: true,
    taskId: taskId,
    message: 'Proses dimulai. Silakan pantau progress.'
  });

  // Process in background
  processVideo(taskId, {
    url,
    start,
    end,
    duration,
    format,
    quality,
    tempFile,
    finalFile,
    filename: outputFilename
  });
});

/**
 * Process video download and trim
 */
async function processVideo(taskId, options) {
  const { url, start, end, duration, format, quality, tempFile, finalFile, filename } = options;

  // Helper to find actual downloaded file (yt-dlp may add format suffix)
  function findDownloadedFile(basePath) {
    const dir = path.dirname(basePath);
    const basename = path.basename(basePath, path.extname(basePath));
    const files = fs.readdirSync(dir);

    // Look for files matching the temp pattern
    const matches = files.filter(f => f.startsWith(basename) || f.includes(path.basename(basePath, '.mp4')));

    // Return exact match first, then any matching file
    if (fs.existsSync(basePath)) return basePath;

    for (const file of matches) {
      const fullPath = path.join(dir, file);
      if (fs.existsSync(fullPath) && (file.endsWith('.mp4') || file.endsWith('.mp3') || file.endsWith('.webm') || file.endsWith('.mkv'))) {
        return fullPath;
      }
    }
    return basePath;
  }

  try {
    sendProgress(taskId, {
      status: 'downloading',
      progress: 5,
      message: 'Memulai pengunduhan video...'
    });

    // Step 1: Download video using yt-dlp with spawn for real-time progress
    logger.info('Starting download', { taskId, format, quality });

    // Build command string for Windows compatibility
    let ytDlpCommand;
    if (format === 'mp3') {
      ytDlpCommand = `yt-dlp -f "bestaudio/best" --extract-audio --audio-format mp3 --newline --progress -o "${tempFile}" "${url}"`;
    } else {
      // Use simpler format selection that's more compatible
      ytDlpCommand = `yt-dlp -f "bestvideo[height<=${quality}]+bestaudio/best[height<=${quality}]/best" --merge-output-format mp4 --newline --progress -o "${tempFile}" "${url}"`;
    }

    logger.debug('yt-dlp command', { taskId, command: ytDlpCommand.replace(url, '[URL]') });

    // Use spawn with shell: true and the full command
    await new Promise((resolve, reject) => {
      const ytProcess = spawn(ytDlpCommand, [], { shell: true });

      let lastProgress = 5;
      let errorOutput = '';

      ytProcess.stdout.on('data', (data) => {
        const output = data.toString();
        logger.debug('yt-dlp stdout', { taskId, output: output.substring(0, 100) });

        // Parse progress percentage from yt-dlp output
        const match = output.match(/(\d+\.?\d*)%/);
        if (match) {
          const downloadPercent = parseFloat(match[1]);
          // Scale download progress to 5-65% range
          const scaledProgress = Math.min(5 + (downloadPercent * 0.6), 65);

          if (scaledProgress > lastProgress) {
            lastProgress = scaledProgress;
            sendProgress(taskId, {
              status: 'downloading',
              progress: Math.round(scaledProgress),
              message: `Mengunduh video... ${Math.round(downloadPercent)}%`
            });
          }
        }
      });

      ytProcess.stderr.on('data', (data) => {
        const output = data.toString();
        errorOutput += output;
        logger.debug('yt-dlp stderr', { taskId, output: output.substring(0, 200) });

        // Also check stderr for progress (yt-dlp outputs progress here)
        const match = output.match(/(\d+\.?\d*)%/);
        if (match) {
          const downloadPercent = parseFloat(match[1]);
          const scaledProgress = Math.min(5 + (downloadPercent * 0.6), 65);

          if (scaledProgress > lastProgress) {
            lastProgress = scaledProgress;
            sendProgress(taskId, {
              status: 'downloading',
              progress: Math.round(scaledProgress),
              message: `Mengunduh video... ${Math.round(downloadPercent)}%`
            });
          }
        }
      });

      ytProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          logger.error('yt-dlp failed', { taskId, code, errorOutput: errorOutput.substring(0, 500) });
          reject(new Error(`Download gagal (code ${code}): ${errorOutput.substring(0, 200)}`));
        }
      });

      ytProcess.on('error', (err) => {
        logger.error('yt-dlp spawn error', { taskId, error: err.message });
        reject(err);
      });
    });

    sendProgress(taskId, {
      status: 'downloading',
      progress: 65,
      message: 'Download selesai, mempersiapkan trimming...'
    });

    // Find the actual downloaded file (yt-dlp may add suffix like .f399)
    const actualTempFile = findDownloadedFile(tempFile);
    logger.info('Downloaded file found', { taskId, actualTempFile });

    if (!fs.existsSync(actualTempFile)) {
      throw new Error('File download tidak ditemukan');
    }

    sendProgress(taskId, {
      status: 'trimming',
      progress: 70,
      message: 'Memotong video sesuai durasi yang dipilih...'
    });

    // Step 2: Trim video using ffmpeg
    // Use -t (duration) instead of -to (end time) for accurate trimming
    const durationSec = duration; // Already calculated in the route handler

    logger.info('Trimming with ffmpeg', { taskId, start, durationSec, actualTempFile, finalFile });

    // Use spawn for ffmpeg too
    await new Promise((resolve, reject) => {
      const ffmpegArgs = [
        '-y',                    // Overwrite output file
        '-i', actualTempFile,    // Input file
        '-ss', start,            // Start time (input seeking - faster)
        '-t', durationSec.toString(), // Duration in seconds
        '-c:v', 'copy',          // Copy video codec (fast)
        '-c:a', 'aac',           // Re-encode audio to AAC (compatible)
        '-avoid_negative_ts', 'make_zero',
        finalFile                // Output file
      ];

      const ffProcess = spawn('ffmpeg', ffmpegArgs, { shell: true });

      ffProcess.stderr.on('data', (data) => {
        const output = data.toString();
        // FFmpeg outputs progress to stderr
        if (output.includes('time=')) {
          sendProgress(taskId, {
            status: 'trimming',
            progress: 85,
            message: 'Memotong video...'
          });
        }
      });

      ffProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`ffmpeg exited with code ${code}`));
        }
      });

      ffProcess.on('error', (err) => {
        reject(err);
      });
    });

    logger.info('Trim complete', { taskId });

    // Step 3: Cleanup temp file
    sendProgress(taskId, {
      status: 'cleaning',
      progress: 96,
      message: 'Membersihkan file temporary...'
    });

    // Clean up all temp files matching the pattern
    try {
      const dir = path.dirname(tempFile);
      const basename = path.basename(tempFile, path.extname(tempFile));
      const files = fs.readdirSync(dir);

      files.forEach(file => {
        if (file.startsWith(basename) || file.startsWith('temp_' + taskId.split('_')[1])) {
          const fullPath = path.join(dir, file);
          if (fullPath !== finalFile && fs.existsSync(fullPath)) {
            try {
              fs.unlinkSync(fullPath);
              logger.debug('Temp file deleted', { taskId, file });
            } catch (e) {
              logger.warn('Could not delete temp file', { file, error: e.message });
            }
          }
        }
      });
    } catch (e) {
      logger.warn('Error during cleanup', { taskId, error: e.message });
    }

    // Verify final file exists
    if (!fs.existsSync(finalFile)) {
      throw new Error('File hasil trim tidak ditemukan');
    }

    // Step 4: Complete!
    sendProgress(taskId, {
      status: 'complete',
      progress: 100,
      message: 'Selesai! Mengunduh file...',
      filename: filename
    });

    logger.info('Task completed successfully', { taskId, filename, finalFile });

  } catch (error) {
    logger.error('Error processing video', { taskId, error: error.message, stack: error.stack });

    // Cleanup on error - clean all temp files
    try {
      const dir = path.dirname(tempFile);
      const files = fs.readdirSync(dir);

      files.forEach(file => {
        if (file.includes(taskId) || file.startsWith(path.basename(tempFile, '.mp4'))) {
          const fullPath = path.join(dir, file);
          if (fs.existsSync(fullPath)) {
            try { fs.unlinkSync(fullPath); } catch (e) { }
          }
        }
      });
    } catch (e) { }

    sendProgress(taskId, {
      status: 'error',
      progress: 0,
      message: `Error: ${error.message}`
    });
  }
}

// ===========================================
// DOWNLOAD ENDPOINT
// ===========================================

app.get('/download/:filename', (req, res) => {
  const { filename } = req.params;

  // Sanitize filename
  const sanitized = validators.sanitizeFilename(filename.replace(/\.(mp4|mp3)$/, ''));
  const extension = filename.endsWith('.mp3') ? 'mp3' : 'mp4';
  const safeFilename = `${sanitized}.${extension}`;

  const filePath = path.join(__dirname, `../../${safeFilename}`);

  logger.info('Download requested', { filename: safeFilename });

  if (!fs.existsSync(filePath)) {
    logger.warn('File not found', { filename: safeFilename });
    return res.status(404).json({
      success: false,
      message: 'File tidak ditemukan'
    });
  }

  // Set headers for download
  res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
  res.setHeader('Content-Type', extension === 'mp3' ? 'audio/mpeg' : 'video/mp4');

  // Stream file to client
  const fileStream = fs.createReadStream(filePath);

  fileStream.pipe(res);

  // Delete file after download completes (if enabled)
  fileStream.on('end', () => {
    if (config.cleanup.autoDeleteAfterDownload) {
      logger.info('Download complete, cleaning up', { filename: safeFilename });
      setTimeout(() => {
        try {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            logger.debug('File deleted after download', { filename: safeFilename });
          }
        } catch (e) {
          logger.warn('Could not delete file after download', { error: e.message });
        }
      }, 2000);
    }
  });

  fileStream.on('error', (err) => {
    logger.error('Stream error', { error: err.message, filename: safeFilename });
    res.status(500).json({
      success: false,
      message: 'Error streaming file'
    });
  });
});

// ===========================================
// UTILITY ENDPOINTS
// ===========================================

app.get('/health', async (req, res) => {
  const diskStatus = await checkAvailableSpace();

  res.json({
    status: 'OK',
    message: 'YT-Trimmer Server is running',
    version: '2.1.0',
    timestamp: new Date().toISOString(),
    environment: config.nodeEnv,
    disk: {
      freeSpaceMB: diskStatus.freeSpaceMB,
      hasEnoughSpace: diskStatus.hasSpace
    }
  });
});

// 404 handler
app.use((req, res) => {
  logger.debug('404 Not Found', { path: req.path });
  res.status(404).json({
    success: false,
    message: 'Endpoint not found'
  });
});

// Error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled server error', { error: err.message, stack: err.stack });
  res.status(500).json({
    success: false,
    message: 'Internal server error'
  });
});

// ===========================================
// PERIODIC CLEANUP
// ===========================================

// Cleanup old temp files periodically
setInterval(() => {
  const baseDir = path.join(__dirname, '../../');

  try {
    const files = fs.readdirSync(baseDir);
    const now = Date.now();

    files.forEach(file => {
      if (file.startsWith('temp_') && (file.endsWith('.mp4') || file.endsWith('.mp3'))) {
        const filePath = path.join(baseDir, file);
        const stats = fs.statSync(filePath);
        const ageMs = now - stats.mtimeMs;

        // Delete temp files older than 1 hour
        if (ageMs > config.cleanup.cleanupIntervalMs) {
          fs.unlinkSync(filePath);
          logger.info('Cleaned up old temp file', { file });
        }
      }
    });
  } catch (e) {
    logger.warn('Error during cleanup', { error: e.message });
  }
}, config.cleanup.cleanupIntervalMs);

// ===========================================
// START SERVER
// ===========================================

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

app.listen(config.port, () => {
  logger.info('===========================================');
  logger.info(`        Bibboys YTrimmer Server v2.1`);
  logger.info('===========================================');
  logger.info(`Server running at: \x1b[36mhttp://localhost:${config.port}\x1b[0m`);
  logger.info(`Serving files from: ${path.join(__dirname, config.paths.public)}`);
  logger.info(`Environment: ${config.nodeEnv}`);
  logger.info('===========================================');
  logger.info(' > COMMAND RUNNING :');
  logger.info('npm start       # Start production server');
  logger.info('npm run dev     # Start development server');
  logger.info('npm run trim    # CLI: single video trim');
  logger.info('npm run trimall # CLI: multiple video trims');
  logger.info('npm run clean   # Clean temp files');
  logger.info('npm run build   # Build Tailwind CSS');
  logger.info('===========================================');
  logger.info(` ✓ Rate Limiting (${config.rateLimit.max}/min)`);
  logger.info(` ✓ Max Duration: ${config.video.maxDurationSeconds / 60} minutes`);
});
