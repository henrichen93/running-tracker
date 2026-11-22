# 🏃 Running Tracker: web theo dõi giải chạy nội bộ

Web tĩnh trên **GitHub Pages** (miễn phí), tự lấy dữ liệu **Strava** mỗi 15 phút (:00, :15, :30, :45).

- Bảng xếp hạng: tổng km hợp lệ, % hoàn thành, lọc theo Nam/Nữ (hoặc nhóm tuỳ ý)
- Trang chi tiết từng người: biểu đồ theo ngày, danh sách hoạt động; hoạt động **không hợp lệ được tô đỏ kèm lý do**
- Quy tắc: pace hợp lệ 4:00–18:00/km (sửa được), môn được tính, có nhận hoạt động nhập tay không, km tối thiểu mỗi lần
- Admin: tạo/nhân bản nhiều giải, đặt mục tiêu km theo nhóm hoặc từng người, duyệt/loại từng hoạt động, bổ sung km thủ công
- Thành viên tự tham gia: gửi link → mỗi người bấm "Kết nối Strava" một lần là xong

## Kiến trúc

```
Thành viên ──(bấm Kết nối 1 lần)──▶ Cloudflare Worker ──lưu token──▶ Workers KV
                                          ▲
GitHub Actions (mỗi 2h) ──xin token───────┘
        │  gọi Strava API, tính điểm
        ▼
   data/*.json ──▶ GitHub Pages (index.html, admin.html)
```

> **Vì sao cần Worker?** Strava **không cho** đọc hoạt động của người khác chỉ bằng Strava ID.
> Mỗi người phải tự cấp quyền (OAuth) một lần. Bước đổi mã lấy token cần `client_secret`, mà secret
> không thể để trên web tĩnh. Cloudflare Worker (gói free) làm đúng việc đó, khoảng 100 dòng code.

---

## Cài đặt (~20 phút, làm một lần)

### 1. Tạo repo GitHub
1. Tạo repo mới (public), ví dụ `running-tracker`, rồi push toàn bộ thư mục này lên nhánh `main`.
2. **Settings → Pages → Source: GitHub Actions**.
3. Web sẽ ở `https://<username>.github.io/running-tracker/`.

### 2. Tạo ứng dụng Strava API
1. Vào https://www.strava.com/settings/api và tạo app.
2. **Authorization Callback Domain**: điền domain của Worker ở bước 3, ví dụ `running-tracker-strava.<tên>.workers.dev`
   (làm bước 3 trước để biết domain, rồi quay lại sửa cũng được).
3. Ghi lại **Client ID** và **Client Secret**.

> ⚠️ App Strava mới tạo chỉ cho **1 người** kết nối (chế độ "Single Player").
> Muốn cả công ty dùng, gửi form xin tăng giới hạn (athlete capacity) tại
> https://developers.strava.com/ → *My API Application* → yêu cầu review. Nên gửi sớm vì có thể mất vài ngày.

### 3. Deploy Cloudflare Worker (miễn phí)
```bash
cd worker
npx wrangler login
npx wrangler kv namespace create ATHLETES       # copy id vào wrangler.toml
# Sửa wrangler.toml: STRAVA_CLIENT_ID, SITE_URL, id của KV
npx wrangler secret put STRAVA_CLIENT_SECRET    # dán Client Secret
npx wrangler secret put SYNC_KEY                # dán một chuỗi ngẫu nhiên dài, ví dụ: openssl rand -hex 32
npx wrangler secret put GH_DISPATCH_TOKEN       # token GitHub để Worker hẹn giờ sync (xem bên dưới)
npx wrangler deploy
```
`GH_DISPATCH_TOKEN`: tạo tại https://github.com/settings/personal-access-tokens/new → chỉ chọn repo của giải →
Permissions: **Actions: Read and write** (chỉ cần quyền này). Worker dùng nó để kích hoạt sync **đúng** :00, :15, :30, :45
(lịch có sẵn của GitHub Actions hay trễ 5–15 phút, nên chỉ giữ làm dự phòng mỗi 3 tiếng).

Lệnh deploy in ra URL, ví dụ `https://running-tracker-strava.<tên>.workers.dev`.

### 4. Nối các phần lại
1. GitHub repo → **Settings → Secrets and variables → Actions → New secret**: `SYNC_KEY` = chuỗi giống bước 3.
2. Mở `https://<username>.github.io/running-tracker/admin.html` → **Đăng nhập bằng GitHub token** (trang có hướng dẫn tạo token)
   → tab **Cài đặt** → dán **Worker URL** → **Lưu & xuất bản**.

3. **Đăng ký Strava webhook** (bắt buộc để sync 15 phút/lần mà không chạm giới hạn Strava). Chạy 1 lần:
   ```bash
   curl -X POST -H "Authorization: Bearer <SYNC_KEY>" https://<worker-url>/webhook/setup
   ```
   Thấy `"ok": true` là xong. Từ giờ Strava sẽ tự báo cho Worker khi có ai chạy xong, sync chỉ lấy dữ liệu của người đó.

Xong! Vào tab **Thành viên** → **Copy link** → gửi vào group công ty.

---

## Dùng hằng ngày

| Việc | Làm ở đâu |
|---|---|
| Tạo giải mới | Admin → Giải chạy → **Tạo giải mới** (hoặc **Nhân bản** giải cũ) |
| Đặt km mục tiêu Nam/Nữ | Admin → giải → 🎯 Mục tiêu |
| Mục tiêu riêng 1 người | Admin → giải → 👥 Người tham gia → cột "Mục tiêu riêng" |
| Thêm nhóm (U40, 40+…) | Admin → Cài đặt → Nhóm |
| Đổi khoảng pace hợp lệ | Admin → Cài đặt (mặc định) hoặc từng giải |
| Loại / duyệt một hoạt động | Đăng nhập admin, mở trang chi tiết người đó → nút **Loại** / **Duyệt** |
| Cộng km cho người chạy giải offline | Admin → giải → ✍️ Hoạt động bổ sung |
| Cập nhật dữ liệu ngay | Admin → **⟳ Sync Strava** |
| Thêm nhiều người một lúc | Admin → Thành viên → **Dán danh sách** (Tên, StravaID, Nhóm) |

Mọi cấu hình nằm trong `config.json`, nên cũng có thể sửa trực tiếp trên GitHub.

### Các lý do một hoạt động bị đánh dấu không hợp lệ
- Pace nhanh hơn mức tối thiểu (mặc định 4:00/km), thường do đạp xe/đi xe mà ghi là Run
- Pace chậm hơn mức tối đa (mặc định 18:00/km), thường là đi bộ hoặc quên tắt đồng hồ
- Không phải môn chạy (nếu bật "hiện cả môn khác")
- Nhập tay trên Strava, không có GPS (nếu không cho phép)
- Bị Strava gắn cờ (flagged)
- Ngắn hơn km tối thiểu mỗi lần (nếu có đặt)
- BTC loại thủ công, kèm lý do

## Xem thử trên máy
```bash
node scripts/demo.mjs          # tạo dữ liệu giả trong demo/
python3 -m http.server 8000    # hoặc: npx serve .
# mở http://localhost:8000/?demo
```

## Ai được vào trang quản trị?
`admin.html` là trang công khai, nhưng **chỉ người có quyền ghi (write) vào repo GitHub** mới đăng nhập được.
Khi đăng nhập, trang kiểm tra token với GitHub. Token sai, hoặc tài khoản không phải collaborator của repo, thì không vào được.
Kể cả khi ai đó sửa code trên trình duyệt để "vào" giao diện admin, họ vẫn không lưu được gì,
vì mọi thay đổi đi qua GitHub API và GitHub chặn những tài khoản không có quyền ghi.

- **Thêm người vào BTC**: repo → Settings → Collaborators → Add people
- **Gỡ quyền**: xoá họ khỏi Collaborators, token của họ mất tác dụng ngay
- Nút Duyệt/Loại trên trang chi tiết cũng chỉ hiện với người đã xác thực quyền ghi

## Giới hạn & lưu ý
- **Lịch đồng bộ**: Cloudflare Worker cron `0,15,30,45 * * * *` (trong `worker/wrangler.toml`) gọi GitHub Actions đúng giờ.
  Sau khi được gọi, GitHub cần khoảng 10–30 giây để khởi động, sync xong sau khoảng 1 phút.
  Lịch dự phòng của GitHub chạy mỗi 3 tiếng, phòng khi Worker cron lỗi.
  Lần nào không có dữ liệu mới thì không commit, không deploy lại.
- **Strava rate limit** (~100 request/15 phút, ~1.000/ngày): nhờ webhook, mỗi lần sync chỉ gọi Strava cho những người vừa có hoạt động mới.
  Ngoài ra cứ 3 tiếng sẽ quét toàn bộ một lần (đổi bằng `"sync": { "fullRefreshHours": 3 }` trong `config.json`),
  nên dùng ổn cho khoảng **300 người**. **Nếu chưa đăng ký webhook** thì lần sync nào cũng phải quét toàn bộ, chỉ chịu được khoảng 10 người.
- **GitHub Actions**: repo phải để **public** (GitHub Pages miễn phí cũng yêu cầu vậy). Repo public thì Actions không giới hạn phút chạy.
  Repo private chỉ có 2.000 phút/tháng, không đủ cho lịch 15 phút/lần.
- Mặc định chỉ đọc hoạt động công khai/người theo dõi. Hoạt động để "Chỉ mình tôi" không được tính.
  Muốn tính cả loại đó thì đổi `STRAVA_SCOPE` trong `worker/wrangler.toml` thành `read,activity:read_all`.
- **Quyền riêng tư**: web GitHub Pages là công khai. Ai có link đều xem được tên + quãng đường + tên hoạt động.
  Strava API Agreement (từ 11/2024) hạn chế việc hiển thị dữ liệu của người dùng cho người khác.
  Nên dùng nội bộ, không quảng bá link, và báo rõ cho mọi người khi họ bấm tham gia.
- Ngày được tính theo giờ địa phương của hoạt động (`start_date_local`).

## Cấu trúc
```
index.html, admin.html, assets/   Web (vanilla JS, không cần build)
config.json                       Cấu hình giải, thành viên, quy tắc (admin sửa)
data/                             Do GitHub Actions sinh ra, đừng sửa tay
scripts/sync.mjs                  Lấy dữ liệu Strava + tính điểm
scripts/demo.mjs                  Sinh dữ liệu demo
worker/                           Cloudflare Worker (OAuth Strava)
.github/workflows/sync.yml        Cron sync + deploy Pages
```
