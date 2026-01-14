require('dotenv').config();

/**
 * Application Configuration
 * Centralized config using environment variables with defaults
 */
const config = {
    // Server
    port: parseInt(process.env.PORT) || 3000,
    nodeEnv: process.env.NODE_ENV || 'development',
    isDev: process.env.NODE_ENV !== 'production',

    // Rate Limiting
    rateLimit: {
        windowMs: parseInt(process.env.RATE_LIMIT_WINDOW) || 60000,
        max: parseInt(process.env.RATE_LIMIT_MAX) || 10
    },

    // Video Processing
    video: {
        maxDurationSeconds: parseInt(process.env.MAX_DURATION_SECONDS) || 600,
        maxFileSizeMB: parseInt(process.env.MAX_FILE_SIZE_MB) || 500,
        supportedFormats: ['mp4', 'mp3'],
        supportedQualities: ['360', '720', '1080']
    },

    // Disk Space
    disk: {
        minFreeSpaceMB: parseInt(process.env.MIN_DISK_SPACE_MB) || 1024
    },

    // Cleanup
    cleanup: {
        autoDeleteAfterDownload: process.env.AUTO_DELETE_AFTER_DOWNLOAD !== 'false',
        cleanupIntervalMs: parseInt(process.env.CLEANUP_INTERVAL_MS) || 3600000
    },

    // Paths
    paths: {
        public: '../../public',
        temp: '../../temp',
        output: '../../'
    }
};

module.exports = config;
