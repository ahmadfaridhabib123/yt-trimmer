const checkDiskSpace = require('check-disk-space').default;
const path = require('path');
const config = require('../config');
const logger = require('./logger');

/**
 * Check if there's enough disk space for download
 * @returns {Promise<{hasSpace: boolean, freeSpaceMB: number, requiredMB: number}>}
 */
async function checkAvailableSpace() {
    try {
        const rootPath = path.parse(__dirname).root;
        const diskSpace = await checkDiskSpace(rootPath);

        const freeSpaceMB = Math.floor(diskSpace.free / (1024 * 1024));
        const requiredMB = config.disk.minFreeSpaceMB;

        logger.debug(`Disk space check: ${freeSpaceMB}MB free, ${requiredMB}MB required`);

        return {
            hasSpace: freeSpaceMB >= requiredMB,
            freeSpaceMB,
            requiredMB
        };
    } catch (error) {
        logger.error('Error checking disk space', { error: error.message });
        // On error, assume there's space (fail-open)
        return {
            hasSpace: true,
            freeSpaceMB: -1,
            requiredMB: config.disk.minFreeSpaceMB
        };
    }
}

/**
 * Middleware to check disk space before processing
 */
async function diskSpaceMiddleware(req, res, next) {
    const { hasSpace, freeSpaceMB, requiredMB } = await checkAvailableSpace();

    if (!hasSpace) {
        logger.warn('Insufficient disk space', { freeSpaceMB, requiredMB });
        return res.status(503).json({
            success: false,
            message: `Server tidak memiliki cukup ruang disk. Tersedia: ${freeSpaceMB}MB, Dibutuhkan: ${requiredMB}MB`
        });
    }

    next();
}

module.exports = {
    checkAvailableSpace,
    diskSpaceMiddleware
};
