const { execSync } = require('child_process');
const readline = require('readline-sync'); // Kita pinjam alat input

// Fungsi konversi waktu ke detik
function timeToSeconds(timeString) {
  if (!timeString) return 0;
  const parts = timeString.toString().split(':');
  let seconds = 0;
  let multiplier = 1;
  while (parts.length > 0) {
    seconds += multiplier * parseInt(parts.pop(), 10);
    multiplier *= 60;
  }
  return seconds;
}

async function download(content) {
  console.log('\n---------------------------------------');

  // 1. CEK WAKTU: Jika tidak terbaca, TANYA LAGI MANUAL
  let startTime = content.startTime || content.start;
  let endTime = content.endTime || content.end;

  if (!startTime) {
    console.log('⚠️ Waktu mulai tidak terdeteksi otomatis.');
    startTime = readline.question('Masukkan Waktu Mulai (contoh 00:03:01): ');
  }

  if (!endTime) {
    console.log('⚠️ Waktu selesai tidak terdeteksi otomatis.');
    endTime = readline.question('Masukkan Waktu Selesai (contoh 00:04:05): ');
  }

  // Hitung durasi
  const startSec = timeToSeconds(startTime);
  const endSec = timeToSeconds(endTime);
  const duration = endSec - startSec;

  // Validasi Durasi
  if (duration <= 0) {
    console.error(`❌ Durasi tidak valid (${duration} detik). Cek input waktumu.`);
    return;
  }

  // Nama file
  let fileName = content.fileName || content.filename || 'video_potong.mp4';
  if (!fileName.endsWith('.mp4')) fileName += '.mp4';

  console.log(`\n> 🎬 DATA FINAL: Start=${startTime} | End=${endTime} | Durasi=${duration}s`);

  try {
    // 2. DOWNLOAD & TRIM
    const videoUrl = execSync(`yt-dlp -f "bestvideo[height<=1080][ext=mp4]/bestvideo" -g "${content.url}"`, { shell: true }).toString().trim();
    const audioUrl = execSync(`yt-dlp -f "bestaudio[ext=m4a]/bestaudio" -g "${content.url}"`, { shell: true }).toString().trim();

    const command = `ffmpeg -ss ${startTime} -i "${videoUrl}" -ss ${startTime} -i "${audioUrl}" -t ${duration} -c:v copy -c:a aac -preset ultrafast -y "${fileName}"`;

    console.log('> ⏳ Memproses di FFmpeg...');
    execSync(command, { stdio: 'inherit', shell: true });

    console.log(`\n✅ SUKSES! File: ${fileName}`);

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
  }
}

module.exports = download;
