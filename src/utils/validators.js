/**
 * Input Validators Module
 * Centralized validation and sanitization functions
 */

const config = require('../config');

/**
 * Sanitize and validate YouTube URL
 * Protects against command injection
 */
function sanitizeYouTubeUrl(url) {
    if (!url || typeof url !== 'string') {
        return null;
    }

    // Length check - URLs shouldn't be too long
    if (url.length > 200) {
        return null;
    }

    // Remove any shell-dangerous characters
    const sanitized = url.trim();

    // Strict YouTube URL pattern
    const youtubePatterns = [
        /^https?:\/\/(www\.)?youtube\.com\/watch\?v=[\w-]{11}(&.*)?$/,
        /^https?:\/\/youtu\.be\/[\w-]{11}(\?.*)?$/,
        /^https?:\/\/(www\.)?youtube\.com\/shorts\/[\w-]{11}(\?.*)?$/,
        /^https?:\/\/(www\.)?youtube\.com\/embed\/[\w-]{11}(\?.*)?$/
    ];

    const isValid = youtubePatterns.some(pattern => pattern.test(sanitized));

    if (!isValid) {
        return null;
    }

    // Extra safety: ensure no shell metacharacters
    if (/[;&|`$(){}[\]<>\\]/.test(sanitized)) {
        return null;
    }

    return sanitized;
}

/**
 * Extract video ID from YouTube URL
 */
function extractVideoId(url) {
    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/
    ];

    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) return match[1];
    }
    return null;
}

/**
 * Sanitize filename
 */
function sanitizeFilename(filename) {
    if (!filename || typeof filename !== 'string') {
        return 'video-part';
    }

    // Length check
    if (filename.length > 100) {
        filename = filename.substring(0, 100);
    }

    // Only allow alphanumeric, dash, underscore
    return filename.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50) || 'video-part';
}

/**
 * Validate time format (HH:mm:ss or mm:ss or HH:mm:ss.ms)
 */
function validateTimeFormat(time) {
    if (!time || typeof time !== 'string') return null;

    // Length check
    if (time.length > 20) return null;

    const patterns = [
        /^\d{1,2}:\d{2}:\d{2}(\.\d+)?$/,  // HH:mm:ss or HH:mm:ss.ms
        /^\d{1,2}:\d{2}(\.\d+)?$/          // mm:ss or mm:ss.ms
    ];

    if (patterns.some(p => p.test(time))) {
        return time;
    }
    return null;
}

/**
 * Convert time string to seconds
 */
function timeToSeconds(timeStr) {
    const parts = timeStr.split(':').map(Number);
    if (parts.length === 3) {
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
        return parts[0] * 60 + parts[1];
    }
    return 0;
}

/**
 * Validate format selection
 */
function validateFormat(format) {
    return config.video.supportedFormats.includes(format) ? format : 'mp4';
}

/**
 * Validate quality selection
 */
function validateQuality(quality) {
    return config.video.supportedQualities.includes(quality) ? quality : '720';
}

/**
 * Validate complete trim request
 */
function validateTrimRequest(body) {
    const errors = [];

    const url = sanitizeYouTubeUrl(body.url);
    if (!url) {
        errors.push('URL YouTube tidak valid');
    }

    const start = validateTimeFormat(body.start);
    const end = validateTimeFormat(body.end);

    if (!start) {
        errors.push('Format waktu mulai tidak valid');
    }

    if (!end) {
        errors.push('Format waktu selesai tidak valid');
    }

    if (start && end) {
        const startSec = timeToSeconds(start);
        const endSec = timeToSeconds(end);
        const duration = endSec - startSec;

        if (duration <= 0) {
            errors.push('Waktu selesai harus lebih besar dari waktu mulai');
        }

        if (duration > config.video.maxDurationSeconds) {
            errors.push(`Durasi maksimal adalah ${config.video.maxDurationSeconds / 60} menit`);
        }
    }

    return {
        isValid: errors.length === 0,
        errors,
        data: {
            url,
            start,
            end,
            filename: sanitizeFilename(body.filename),
            format: validateFormat(body.format),
            quality: validateQuality(body.quality)
        }
    };
}

module.exports = {
    sanitizeYouTubeUrl,
    extractVideoId,
    sanitizeFilename,
    validateTimeFormat,
    timeToSeconds,
    validateFormat,
    validateQuality,
    validateTrimRequest
};
