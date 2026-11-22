#!/usr/bin/env node
// Tạo dữ liệu giả trong thư mục demo/ để xem thử giao diện:
//   node scripts/demo.mjs && npx serve .   -> mở http://localhost:3000/?demo
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const NAMES = [
  ['Nguyễn Văn An', 'Nam'], ['Trần Thị Bình', 'Nữ'], ['Lê Hoàng Cường', 'Nam'], ['Phạm Thu Dung', 'Nữ'],
  ['Võ Minh Đức', 'Nam'], ['Hoàng Ngọc Hà', 'Nữ'], ['Đặng Quốc Huy', 'Nam'], ['Bùi Thanh Lan', 'Nữ'],
  ['Đỗ Tuấn Minh', 'Nam'], ['Ngô Mai Phương', 'Nữ'], ['Dương Gia Bảo', 'Nam'], ['Lý Khánh Linh', 'Nữ'],
];

let seed = 42;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const start = iso(new Date(today.getTime() - 20 * 86400e3));
const end = iso(new Date(today.getTime() + 10 * 86400e3));

const config = JSON.parse(await fs.readFile('config.json', 'utf8'));
config.site.title = 'Giải chạy nội bộ (DEMO)';
config.members = NAMES.map(([name, group], i) => ({ name, stravaId: String(1000 + i), group }));
config.members.push({ name: 'Người chưa kết nối', stravaId: '1999', group: 'Nam' });
config.events = [
  {
    ...config.events[0],
    id: 'demo-thang-nay',
    name: 'Chạy vì sức khoẻ (demo)',
    description: 'Tích luỹ km trong 30 ngày',
    start, end,
    targets: { Nam: 150, Nữ: 100, default: 100 },
    overrides: { 900005: { status: 'invalid', reason: 'Chạy hộ' } },
    manualActivities: [{ athleteId: '1003', date: start, distanceKm: 10, movingTime: '1:02:00', name: 'Giải chạy offline' }],
  },
];

await fs.rm('demo', { recursive: true, force: true });
await fs.mkdir('demo/data/activities', { recursive: true });
await fs.writeFile('demo/config.json', JSON.stringify(config, null, 2));

const athletes = [];
let aid = 900000;
for (let i = 0; i < NAMES.length; i++) {
  const id = String(1000 + i);
  athletes.push({ id, name: NAMES[i][0], avatar: '', group: NAMES[i][1], joinedAt: new Date().toISOString(), revoked: false });
  const acts = [];
  const freq = 0.3 + rnd() * 0.6;
  for (let d = new Date(start); d <= today; d = new Date(d.getTime() + 86400e3)) {
    if (rnd() > freq) continue;
    const km = 3 + rnd() * 9;
    let pace = 5 + rnd() * 3; // phút/km
    let type = 'Run';
    const r = rnd();
    if (r < 0.04) pace = 2.6; // đạp xe ghi nhầm Run
    else if (r < 0.08) pace = 19.5; // đi bộ
    else if (r < 0.1) type = 'Ride';
    const secs = Math.round(km * pace * 60);
    acts.push({
      id: aid++, name: type === 'Ride' ? 'Đạp xe buổi chiều' : rnd() > 0.5 ? 'Chạy buổi sáng' : 'Chạy buổi tối',
      sport_type: type, distance: Math.round(km * 1000), moving_time: secs, elapsed_time: secs + 120,
      start_date_local: `${iso(d)}T0${5 + Math.floor(rnd() * 4)}:${String(Math.floor(rnd() * 60)).padStart(2, '0')}:00Z`,
      total_elevation_gain: Math.round(rnd() * 40), manual: false, flagged: false,
    });
  }
  await fs.writeFile(`demo/data/activities/${id}.json`, JSON.stringify({ covered: [[start, iso(today)]], activities: acts }));
}
await fs.writeFile('demo/data/athletes.json', JSON.stringify(athletes, null, 2));

execFileSync('node', ['scripts/sync.mjs', '--recompute', '--root', 'demo'], { stdio: 'inherit' });
console.log('\nXong! Chạy `npx serve .` rồi mở http://localhost:3000/?demo');
