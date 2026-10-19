# EngPractice – Web luyện bài tập tiếng Anh theo lớp

Giáo viên tải đề (Word/PDF) + đáp án lên → hệ thống tự quét và chia thành các dạng bài → giao cho lớp → học sinh làm bài, nộp là có điểm ngay kèm đáp án đúng và giải thích → giáo viên theo dõi tiến bộ trên dashboard.

Chạy trên **Netlify** (trang tĩnh + Netlify Functions) với **Postgres** (Netlify Database, hoặc Neon/Supabase bất kỳ).

---

## Chức năng

**Giáo viên / quản trị**
- Tải lên file đề `.docx` / `.pdf` / `.txt` (hoặc dán văn bản) và file đáp án riêng – hoặc đáp án nằm cuối file đề dưới tiêu đề “ĐÁP ÁN / KEY”.
- File đáp án có thể là **danh sách** (`1. B  2. C …`) hoặc **bản sao của đề** (phương án đúng in đậm, đáp án ghi trong chỗ trống, câu viết lại ghi đủ sau “→”, kèm giải thích bên dưới) – hệ thống tự nhận dạng và lấy luôn **lời giải thích** cho từng câu.
- **Mặc định bỏ phần Nghe và phần Viết đoạn văn/viết thư** (tự luận) khi quét đề, chỉ giữ các dạng chấm tự động để học sinh tự luyện (bỏ chọn nếu muốn giữ). Đề đã lưu có nút “✂️ Bỏ phần Nghe & Viết”.
- Hỗ trợ đề đánh số lại từ 1 ở mỗi Part (tự đánh số liên tục), dạng ghép đoạn (A. Jeanne / B. Laura…), tìm từ thừa trong đoạn văn, tìm lỗi sai.
- Tự quét đề thành các **chuyên đề**: Nghe hiểu, Phát âm, Trọng âm, Trắc nghiệm từ vựng–ngữ pháp, Giao tiếp, Đồng nghĩa–trái nghĩa, Chia động từ, Giới từ, Từ loại, Tìm lỗi sai, Đọc điền từ, Đọc hiểu, Viết lại câu, Sắp xếp/dựng câu, Viết đoạn/thư.
- Màn hình **kiểm tra kết quả quét**: sửa dạng bài, câu hỏi, phương án, đáp án (nhiều đáp án đúng), giải thích, điểm từng câu; câu thiếu đáp án được tô vàng; gắn link file nghe (mp3 / Google Drive).
- Quản lý **lớp** (theo khối), **học sinh** (thêm từng em, dán danh sách từ Excel, hoặc học sinh tự đăng ký bằng **mã lớp**), tài khoản giáo viên.
- **Giao bài** cho một hay nhiều lớp: thời gian mở, hạn nộp, giới hạn thời gian làm, số lần làm, chế độ hiện đáp án (ngay sau nộp / sau hạn / không hiện).
- **Dashboard**: theo khối → lớp → từng học sinh; tỉ lệ hoàn thành, điểm TB, xu hướng tiến bộ theo tuần, độ chính xác theo chuyên đề, bản đồ nhiệt học sinh × chuyên đề, phân tích câu hỏi (câu nào cả lớp hay sai).
- **Chấm tự luận** (bài viết email/đoạn văn) và sửa điểm bất kỳ câu nào; xuất kết quả lớp ra **CSV** (mở bằng Excel).

**Học sinh**
- Thấy danh sách bài của lớp mình khi giáo viên giao; làm bài có đồng hồ đếm ngược, bản đồ câu hỏi, **tự lưu nháp** (mất mạng/tắt máy vẫn làm tiếp được), hết giờ tự nộp.
- Nộp xong có điểm ngay (thang 10 và theo điểm đề), xem lại từng câu: câu sai hiện **đáp án đúng + giải thích**, lọc “chỉ câu sai”.
- **Luyện theo chuyên đề**: lấy ngẫu nhiên câu hỏi theo dạng bài em còn yếu (chỉ từ bài em đã nộp/đã hết hạn để không lộ đáp án).
- Trang tiến bộ cá nhân: biểu đồ điểm, so sánh với trung bình lớp, điểm mạnh/yếu theo chuyên đề.

---

## Cấu trúc thư mục

```
public/                 Giao diện (HTML/CSS/JS thuần, không cần build)
  js/parser.js          Bộ quét đề + đáp án (chạy trong trình duyệt)
  js/editor.js          Tải đề, sửa đề, giao bài
  js/admin.js           Dashboard, lớp, học sinh, chấm bài
  js/student.js         Trang học sinh, luyện tập
  js/exam-view.js       Làm bài & xem kết quả
  vendor/               mammoth (đọc .docx), pdf.js, Chart.js
netlify/functions/api.mjs   Toàn bộ API (/api/*)
netlify/lib/            Kết nối CSDL, lược đồ bảng, đăng nhập, chấm điểm
scripts/local-server.mjs    Chạy thử trên máy không cần Netlify
test/                   Kiểm thử + file đề/đáp án mẫu
```

**Các bảng dữ liệu** (tự tạo ở lần chạy đầu): `classes` (lớp, khối, mã lớp), `users` (admin/giáo viên/học sinh), `exams` (đề – nội dung JSON gồm các phần & câu hỏi), `assignments` (bài giao cho lớp), `attempts` (lượt làm bài, đáp án, kết quả), `attempt_items` (kết quả từng câu theo chuyên đề – dùng cho dashboard).

---

## Chạy thử trên máy (5 phút)

Cần Node.js 20+.

```bash
npm install
npm run local
```

Mở http://localhost:8888 → tạo tài khoản quản trị → tạo lớp → tải đề trong `test/fixtures/` lên để thử. Dữ liệu lưu ở thư mục `.localdb/` (Postgres chạy ngay trong Node – PGlite).

Chạy kiểm thử: `npm test`. Thử với đề thật của bạn: `npm run test:real -- đường-dẫn/đề.docx đường-dẫn/đáp-án.docx` (thư mục `test/real/` không được đưa lên GitHub).

---

## Deploy lên Netlify (khuyên dùng: Neon làm database)

### Bước 1 – Tạo database Postgres miễn phí trên Neon
1. Vào https://neon.tech → **Sign up** (đăng nhập bằng Google/GitHub).
2. **Create project**: tên `engweb`, Postgres bản mới nhất, **Region: AWS Asia Pacific (Singapore)** (gần Việt Nam/Hàn Quốc nhất).
3. Ở trang **Dashboard → Connect**: bật **Connection pooling**, chọn dạng *Connection string*, bấm **Copy**. Chuỗi có dạng
   `postgresql://user:mật-khẩu@ep-xxxx-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`
   (giữ bí mật chuỗi này). **Không cần tạo bảng** – web tự tạo ở lần chạy đầu.

### Bước 2 – Đưa mã nguồn lên GitHub
1. Giải nén `engweb.zip`. Tạo repo mới trên https://github.com/new (để **Private**).
2. Trong repo: **Add file → Upload files** → kéo *nội dung bên trong* thư mục `engweb` (gồm `public`, `netlify`, `package.json`, `netlify.toml`…) → **Commit changes**.
   Hoặc dùng git: `git init && git add . && git commit -m "first" && git remote add origin <url> && git push -u origin main`.

### Bước 3 – Tạo site trên Netlify
1. https://app.netlify.com → **Add new project → Import an existing project → GitHub** → chọn repo.
2. Giữ nguyên cấu hình (Netlify đọc `netlify.toml`: publish `public`, functions `netlify/functions`) → **Deploy**.

### Bước 4 – Biến môi trường
*Project configuration → Environment variables → Add a variable*:
| Key | Value |
|---|---|
| `DATABASE_URL` | chuỗi kết nối Neon ở bước 1 |
| `JWT_SECRET` | chuỗi ngẫu nhiên dài ≥ 32 ký tự (khoá bảo vệ đăng nhập) |

Sau đó **Deploys → Trigger deploy → Deploy site** (biến môi trường chỉ có hiệu lực sau khi deploy lại).

### Bước 5 – Khởi tạo
Mở địa chỉ `https://<tên-site>.netlify.app` → màn hình **Thiết lập lần đầu** → tạo tài khoản quản trị (**làm ngay**, người đầu tiên vào sẽ thành admin). Kiểm tra trên Neon → *Tables* sẽ thấy 6 bảng: `classes, users, exams, assignments, attempts, attempt_items`.

### Phương án khác
- **Netlify Database** (Postgres có sẵn của Netlify, chỉ có ở một số gói): nếu project của bạn đã bật, Netlify tự đặt `NETLIFY_DB_URL` và web dùng luôn – không cần `DATABASE_URL`.
- **Supabase**: tạo project → *Connect* → copy chuỗi “Transaction pooler” → đặt vào `DATABASE_URL`.
- **Netlify CLI**: `npm i -g netlify-cli && netlify login && netlify init && netlify env:set DATABASE_URL "<chuỗi>" && netlify env:set JWT_SECRET "<chuỗi>" && netlify deploy --prod`.

### Lỗi thường gặp
| Hiện tượng | Cách xử lý |
|---|---|
| “Chưa kết nối cơ sở dữ liệu…” | Chưa thêm `DATABASE_URL` hoặc chưa deploy lại sau khi thêm |
| “password authentication failed” | Copy lại chuỗi kết nối từ Neon (có thể đã reset mật khẩu) |
| Trang mở được nhưng mọi thao tác báo lỗi 404 `/api/...` | Kiểm tra *Logs → Functions* có hàm `api`; đảm bảo đã upload thư mục `netlify/` và file `netlify.toml` |
| Lần đầu mở hơi chậm (2–5 giây) | Bình thường – Neon gói free “ngủ” khi không dùng, tự thức dậy |
| Quên mật khẩu admin | Trên Neon → *SQL Editor*: `DELETE FROM users WHERE role='admin';` rồi mở web để thiết lập lại (dữ liệu khác giữ nguyên) |

Sao lưu dữ liệu: Neon có sẵn khôi phục theo thời điểm (*Branches → Restore*); xuất điểm từng lớp ra CSV trong trang lớp.

## Mẹo soạn đề để quét chính xác

- Mỗi dạng bài có tiêu đề `Part 1.` / `Exercise 1.` / `I.` kèm câu hướng dẫn tiếng Anh (Choose…, Rewrite…, Read the passage…). Hệ thống dựa vào câu hướng dẫn để nhận chuyên đề.
- Mỗi câu bắt đầu bằng số: `1.` hoặc `Câu 1:`; phương án `A. … B. … C. … D. …` (cùng dòng hay xuống dòng đều được).
- Phát âm / tìm lỗi sai: dùng **gạch chân** trong Word (giữ nguyên với file .docx). Dạng tìm lỗi có dòng `A B C D` bên dưới câu.
- Viết lại câu: dòng `→ phần đầu cho sẵn` ngay dưới câu gốc; từ khóa đặt trong ngoặc ở cuối câu `(FOR)`.
- Bài đọc điền từ: chỗ trống dạng `(56) ______` trong đoạn văn.
- File đáp án: `1. B`, `1-B`, `Câu 1: B`, nhiều câu trên một dòng, hoặc bảng “Câu | Đáp án”. Nhiều đáp án đúng: `could / was able to` (điền từ) hoặc `câu 1 | câu 2` (viết câu). Giải thích thêm trong ngoặc: `22. B (food /uː/, các từ còn lại /ʊ/)`.
- File `.doc` (Word cũ) → mở bằng Word, *Lưu thành* `.docx`. PDF dạng ảnh scan không đọc được chữ.
- PDF xuất từ Word vẫn giữ được chữ **in đậm** (dùng để nhận đáp án), nhưng mất gạch chân – nên dạng *tìm lỗi sai* trong PDF được chuyển thành “viết từ đúng để sửa lỗi” (lấy từ dòng `fewer => less` trong đáp án). Dùng `.docx` sẽ giữ nguyên dạng A/B/C/D gạch chân.

Sau khi quét luôn có bước **kiểm tra & sửa** trước khi lưu, nên đề định dạng lạ vẫn chỉnh tay được.

## Cách chấm
- Trắc nghiệm, Đúng/Sai: so khớp chữ cái.
- Điền từ, viết câu: không phân biệt hoa/thường, bỏ qua dấu câu cuối, chấp nhận dạng viết tắt (`won't` = `will not`), ghép phần đầu cho sẵn (`→ Are you good` + “at making friends”). Giáo viên có thể sửa điểm bất kỳ câu nào nếu học sinh viết đúng theo cách khác.
- Bài viết tự luận: chờ giáo viên chấm (mục *Chấm tự luận*).
