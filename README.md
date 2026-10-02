# Laporan Aset Yang Belum Diperiksa - PKS

Aplikasi untuk **menggabungkan beberapa fail senarai aset**, mengesan pertindihan dan
konflik data, kemudian mengeksport hasilnya ke Excel / CSV / JSON.

Ia berjalan sebagai **satu Cloudflare Worker**: Worker itu menghidangkan halaman dan
API, dan rekod disimpan dalam **D1**. Tiada pemasangan pada komputer pengguna, tiada
bekas, dan tiada pangkalan data untuk dijaga.

Hasil gabungan dan eksport berlaku **sepenuhnya di dalam pelayar** - fail anda tidak
dimuat naik. Yang dihantar ke D1 hanyalah **rekod yang telah digabung** (label dan
lima medan aset).

Ada **dua peranan**, dan pemisahan itu berlaku di dalam Worker, bukan pada butang:

- **Pembaca (viewer) - awam, tiada log masuk.** Sesiapa yang membuka pautan melihat
  senarai semasa dan Ringkasan Bahagian. Tiada akaun, tiada apa-apa untuk didaftarkan -
  dan tiada Langkah 1, kerana mereka tidak memuat naik apa-apa. **Sejarah Pemeriksaan
  ialah alat admin** dan tidak dirender untuk pembaca sama sekali.
- **Admin - perlu log masuk.** Memuat naik senarai, memadam titik masa dan menetapkan
  Bahagian. Butang **Muat naik senarai** pada tab Senarai Semasa membuka kotak **Log masuk
  admin**; selepas log masuk, dashboard admin (Langkah 1-3) muncul pada halaman yang sama.

Lihat bahagian 2 untuk perbezaan skrin, dan bahagian 3 untuk mengaktifkan log masuk.
Sebelum ia disediakan, Worker menolak **semua** tulisan, jadi pautan awam tidak boleh
diubah oleh sesiapa pun - termasuk admin. Kegagalan itu disengajakan: URL awam yang boleh
ditulis oleh sesiapa bermakna sesiapa yang mempunyai pautan boleh memadam rekod.

---

## 1. Cepat mula

1. Buka alamat Worker (contohnya `https://aset-pks.<akaun>.workers.dev`).
2. Lepaskan semua fail senarai aset ke dalam kotak di **Langkah 1** - fail, beberapa fail,
   satu folder penuh, atau beberapa folder sekali gus.
3. Semak tetapan dan tapisan di **Langkah 2**.
4. Semak tab **Pertindihan** dan **Konflik Data**, kemudian eksport di **Langkah 3**.

Muat naik itu sendiri menjadi satu titik masa dalam tab **Sejarah Pemeriksaan**, dan
ia dikongsi: sesiapa yang membuka alamat yang sama melihat rekod yang sama.

### Fail dalam beberapa folder

Eksport satu laporan biasanya tinggal dalam folder sendiri (satu folder sebulan, satu folder
sejabatan), jadi pemilih fail di **Langkah 1** mengambil folder, bukan hanya fail:

| Cara | Apa yang dibaca |
| --- | --- |
| Lepas ke halaman | fail dan folder, di mana-mana pada halaman |
| **Pilih fail...** | pilihan biasa; ulang untuk menambah daripada folder lain |
| **Tambah folder...** | satu folder penuh, termasuk subfoldernya |

Empat perkara yang telah diputuskan, kerana ia mudah menjadi salah faham:

- **Senarai ditambah, bukan diganti.** Pilih daripada folder A, kemudian folder B, dan
  kedua-duanya berada dalam senarai yang sama.
- **Dialog folder memberi SATU folder setiap kali.** Ini had dialog Windows sendiri:
  Chromium meminta `FOS_PICKFOLDERS` dan tidak pernah `FOS_ALLOWMULTISELECT`, jadi
  menekan CTRL untuk memilih dua folder tetap memberi satu. Halaman ini sudah meminta
  `webkitdirectory` **dan** `multiple` - tidak ada apa-apa lagi yang boleh dibuat di sini.
  Untuk menambah beberapa folder: tekan **Tambah folder...** berulang kali (senarai tidak
  diganti), lepaskan kesemua folder dari Explorer sekali gus, atau pilih folder induk
  kerana subfoldernya diambil sekali.
- **Nama fail tidak unik.** Tiga folder bulanan mengandungi `Senarai_Aset.xls` yang sama
  nama, jadi fail dikenali dengan **laluannya** (`2026-09/Senarai_Aset.xls`) dalam senarai
  fail, tab **Butiran Fail**, dan laporan konflik. Tanpa itu, ketiga-tiganya kelihatan
  seperti satu fail yang sama.
- **Fail yang dilangkau diberitahu.** Folder eksport juga mengandungi `~$Senarai.xls`,
  `.DS_Store`, gambar dan fail lain yang bukan jadual; fail sebegitu tidak dibaca, dan
  satu notis menyatakan berapa banyak dan mengapa. Fail yang **anda** pilih atau lepas
  secara terus tidak ditapis begitu - ia sampai ke penghurai, yang memberi sebabnya sendiri.

Had keselamatan: 400 fail, 8 aras folder, dan 32 MB satu fail. Melepasi had itu bukan
ralat - bakinya dilaporkan sebagai dilangkau.

> **Mod luar talian.** `dist/Laporan_Aset_Belum_Diperiksa_PKS.html` boleh dibuka dengan dua
> klik tanpa sebarang pelayan - tetapi kerana halaman itu kini dipecahkan (lihat bahagian 3),
> folder `dist/assets/` mesti dibawa bersama-sama. Gabung, tapis dan eksport berfungsi penuh
> di sana; **sejarah pemeriksaan** dan **penetapan Bahagian** memerlukan D1 dan tidak
> tersedia. Panel **Sambungan D1** menyatakannya.

### Hasil sebenar yang disahkan

Diuji pada fail sebenar (ABR 473 label, HM 63 label):

| Laporan | Rekod | Awalan label |
| --- | --- | --- |
| ABR | 473 | `I` (331), `R` (142) |
| HM | 63 | `H` (63) |

| Perkara | Nilai |
| --- | --- |
| Label kongsi antara ABR dan HM | **0** |
| Rekod unik hasil gabungan | **536** |
| Pertindihan | 0 |
| Konflik data | 0 |
| Masa hurai + gabung | ~30 ms |

Kedua-dua laporan mengandungi **aset yang berbeza sepenuhnya** - tiada satu pun
label HM muncul dalam ABR. Jadi gabungannya ialah jumlah mudah: 473 + 63 = **536**.

> Jika anda menjangka HM ialah subset ABR (iaitu HM sepatutnya 473 atau kurang),
> maka fail HM yang dieksport memuatkan set aset yang berlainan. Aplikasi akan
> menunjukkan ini dengan jelas: ia melaporkan bilangan pertindihan tepat, jadi
> bilangan pertindihan 0 bermakna tiada label dikongsi.

`tools/scenario-test.mjs` turut menyapu semua kemungkinan pertindihan (0-63) dan
semuanya lulus, jadi enjin ini betul untuk apa jua darjah pertindihan:

| Label yang muncul dalam kedua-dua fail | Rekod unik |
| --- | --- |
| 0 | 536 |
| 40 | 496 |
| 63 (semua HM sudah ada dalam ABR) | 473 |

### Format fail yang diterima

| Format | Keterangan |
| --- | --- |
| `.xls` (jadual HTML) | Eksport "Web Page" daripada sistem - **ini format fail sebenar** |
| `.html` / `.htm` | Jadual HTML biasa |
| `.csv` / `.tsv` / `.txt` | Nilai dipisah koma / tab / titik bertindih |
| `.json` | Termasuk eksport JSON aplikasi ini |

> **Penting:** fail `.xls` daripada sistem e-Harta sebenarnya **bukan** buku kerja
> Excel binari - ia fail HTML yang disimpan dengan sambungan `.xls`. Aplikasi ini
> mengendalikannya, termasuk markup yang tidak lengkap (tag `<tr>` yang tidak ditutup).
>
> Jika anda memilih buku kerja Excel **binari** sebenar, aplikasi akan memberi mesej
> yang jelas dan mencadangkan eksport semula sebagai HTML atau CSV - ia tidak akan
> senyap-senyap menghasilkan data yang salah.

---

## 2. Apa yang aplikasi lakukan

**Lima medan aset** dibaca daripada setiap fail:

`Label` - `Jenis Aset` - `Pegawai Penempatan` - `Bahagian` - `Lokasi Terkini`

> **Satu aset = satu label.** Label ialah identiti aset, seperti kad pengenalan,
> jadi ia tidak sepatutnya berulang.
>
> Medan `Status Aset` dalam fail sumber **diabaikan**. Ia bukan data identiti, dan
> 532 daripada 536 aset berkongsi nilai yang sama ("Sedang Digunakan"), jadi ia
> tidak menambah maklumat berguna. Fail sumber masih mempunyai lajur ini (lajur
> ke-6); penghurai membacanya lalu membuangnya, tanpa menggeser mana-mana medan lain.

Ia kemudian:

- **Menggabungkan** semua fail menjadi satu senarai rekod unik.
- **Mengesan pertindihan** - aset yang muncul dalam lebih daripada satu fail
  (atau berulang dalam fail yang sama) disimpan **sekali sahaja**, dengan kiraan salinan.
- **Mengesan konflik** - label yang sama tetapi butiran berbeza ditandakan untuk
  semakan manusia. Nilai daripada fail pertama dikekalkan, dan nilai bercanggah
  ditunjukkan bersebelahan.
- **Mengesan fail yang sama tepat** melalui cap jari SHA-256, dan memberitahu anda
  apabila dua fail yang dimuatkan mempunyai kandungan yang sama.
- **Menapis dan mencari** mengikut bahagian, atau sebarang teks.
- **Mengeksport** kepada Excel (`.xls`), CSV, dan JSON.
- **Menyimpan dalam D1** - setiap muat naik disimpan dalam pangkalan data, jadi rekod
  **kekal dan dikongsi**. Tiada apa-apa disimpan dalam pelayar.
- **Ringkasan Bahagian** - bilangan aset belum diperiksa bagi setiap bahagian, sekali
  pandang. Klik mana-mana baris untuk menapis senarai penuh kepada bahagian tersebut.
- **Sejarah Pemeriksaan** (admin sahaja) - setiap muat naik menjadi satu titik masa, dan label yang
  **hilang** daripada senarai terbaharu ditunjukkan di situ. Angka **belum diperiksa**,
  **sudah diperiksa** dan **total aset** pada kad tab itu ialah angka **daftar** yang disalin
  oleh admin, bukan kiraan halaman - dan angka belum diperiksa itu ialah rujukan yang
  menyemak setiap muat naik. Lihat bahagian seterusnya.
- **Tetapkan Bahagian** - rekod yang tiada Bahagian dalam fail boleh ditetapkan secara
  manual daripada senarai bahagian sedia ada.

### Dua peranan: admin dan viewer

Pembaca tidak perlu log masuk langsung - senarai ini dokumen awam. Yang memerlukan
log masuk hanya **tulisan**, dan halaman itu sendiri yang menawarkan pintunya.

| | Admin (log masuk) | Viewer (awam) |
| --- | --- | --- |
| Langkah 1 (muat naik) dan Langkah 2 (tetapan gabung) | ada | tiada |
| **Senarai Semasa** (dibaca daripada D1) | ada | skrin utama |
| Ringkasan Bahagian | ada | ada |
| Sejarah Pemeriksaan | ada, termasuk **Padam** | **tiada langsung** - alat admin |
| Tetapkan Bahagian | ada | tiada |
| Pertindihan / Konflik / Butiran Fail | ada | tiada - itu diagnosis gabungan |
| Eksport dan cetak senarai | ada | ada, untuk apa yang dilihat sahaja |

> **Sejarah Pemeriksaan tidak dirender untuk pembaca**, bukan sekadar disembunyikan: tab itu
> membawa angka daftar, pergerakan antara muat naik dan butang padam, dan sinar satu nod yang
> tersembunyi masih boleh dicapai. Tab yang pembaca boleh guna ialah tab yang pembaca dapat.
> Kalau peranan berubah ketika tab itu terbuka (admin log keluar, atau pratonton viewer
> dihidupkan), halaman itu berpindah sendiri ke Senarai Semasa - bukan panel kosong.

**Viewer membaca senarai daripada D1, bukan memuat naik fail.** Senarai itu ialah
pemerhatian terakhir - aset yang masih belum diperiksa - jadi ia sentiasa yang terkini,
dan sesiapa yang membuka halaman yang sama membaca rekod yang sama.

Viewer mendapat kawalan tapisan sendiri (carian, Bahagian, susunan) kerana Langkah 2
disembunyikan daripada mereka, dan boleh **mencetak** senarai itu: cetakan merangkumi
**semua** baris yang ditapis, bukan satu halaman, dan membawa tajuk, bahagian dan
tarikh supaya senarai kertas itu boleh berdiri sendiri.

Pembaca yang bukan admin melihat satu pautan **Admin log masuk** pada panel Sambungan
D1. Pautan itu menuju ke `/api/admin/login` - laluan yang dilindungi Access - jadi
Worker tidak perlu menyimpan sebarang borang log masuk sendiri, dan pembaca yang tidak
log masuk tidak pernah sampai ke API tulis.

> **Butang yang disembunyikan bukan kawalan akses.** Permintaan tulis daripada pembaca
ditolak oleh Worker dengan HTTP 401/403, dan halaman melaporkan penolakan itu dan bukan
berpura-pura berjaya. Tanpa itu, sesiapa sahaja boleh memuat naik dengan `curl`.
> Semua tulisan pergi ke awalan **`/api/admin/*`** supaya Access boleh melindungi
> tepat awalan itu sahaja - bacaan kekal di `/api/*` dan kekal awam.

Admin boleh tekan **Pratonton sebagai viewer** untuk melihat skrin viewer tanpa
menukar peranan sebenar - itulah cara menyemak bahawa sesuatu perubahan tidak
merosakkan paparan mereka.

> **Fail HTML luar talian** (dua klik) tiada D1 untuk dibaca, jadi ia kekal sebagai
alat admin: gabung, tapis dan eksport. Dari situ ia tidak boleh menulis ke D1.

### Tetapkan Bahagian (rekod yang tiada jabatan)

Sebahagian rekod dalam fail sumber mempunyai medan `Bahagian` yang **kosong**. Rekod
ini **tidak muncul** dalam laporan mengikut bahagian dan **tidak boleh ditapis**
mengikut bahagian - jadi ia senyap-senyap mengurangkan bilangan unit yang sebenarnya
memilikinya.

Dalam data sebenar anda, **10 daripada 536 rekod** (semuanya berawalan `R`) tiada
Bahagian. Kesemuanya berada di BENGKEL SHEETMETAL, BENGKEL FOUNDRI, atau Ruang Pejabat
Jab. Mekanikal.

Panel **Tetapkan Bahagian** menyenaraikan rekod itu dengan menu pilihan yang mengandungi
**semua bahagian yang sudah ada dalam data** - supaya bahagian baharu tidak boleh
dicipta secara tersilap taip.

| Perkara | Kelakuan |
| --- | --- |
| Kunci simpanan | **Label aset**, bukan nombor baris |
| Tempat simpanan | Jadual `bahagian_overrides` dalam D1 |
| Kekal selepas | Mengimport semula fail yang dikemas kini, dan pada komputer lain |
| Kesan | Rekod masuk ke bahagian itu dalam **ringkasan, tapisan dan eksport** |
| Batal | Setiap tetapan boleh dibatalkan satu per satu, atau semuanya |
| Bahagian tidak wujud | **Ditolak** - tidak mencipta bahagian palsu |

> **Kenapa disimpan mengikut Label?** Label ialah identiti aset. Menyimpannya mengikut
> nombor baris akan menjadikan setiap tetapan salah sebaik sahaja fail sumber disusun
> semula.
>
> **Ia keputusan anda, bukan tekaan.** Aplikasi **tidak** meneka bahagian daripada
> lokasi. Hanya anda boleh mengesahkan unit mana yang memiliki aset itu.
>
> **Batal jika ditolak.** Jika D1 menolak sesuatu tetapan (bahagian itu tidak wujud
> dalam data), halaman membaca semula keadaan sebenar dari D1. Skrin tidak boleh
> menunjukkan pembetulan yang pangkalan data tidak ada.

### Sejarah Pemeriksaan (cara memantau kemajuan)

Senarai ini ialah **"Aset Belum Diperiksa"**. Ia tiada tarikh dan tiada status
pemeriksaan. Jadi satu-satunya bukti bahawa sesuatu aset sudah diperiksa ialah ia
**hilang** daripada senarai pada muat naik berikutnya.

> **Kecuali angka pada kad.** Kad **Total aset** dan **Sudah diperiksa** **tidak**
dikira daripada pemerhatian itu - ia disalin daripada ringkasan *Sistem Pengurusan Aset
Alih* oleh admin (butang **Kemas kini angka**), kerana daftar itulah yang berkuasa.
Sehingga ia disalin, kad menunjukkan "**- belum ditetapkan**" dan bukan kiraan halaman.

**Cara guna:**

1. Muatkan senarai penuh seperti biasa. Titik masa direkodkan **secara automatik**.
2. Selepas pusingan pemeriksaan seterusnya, eksport semula senarai **penuh** dan
   muatkan semula.
3. Tab **Sejarah Pemeriksaan** akan menunjukkan apa yang berubah.

**Apa yang dilaporkan setiap muat naik:**

| Perkara | Maksud |
| --- | --- |
| **Hilang** | Ada dalam senarai lama, tiada dalam senarai baharu (inilah yang diukur oleh lajur "Hilang") |
| **Masih belum** | Ada dalam kedua-dua senarai |
| **Baharu** | Muncul kali pertama - aset baharu didaftarkan |
| **Muncul semula** | Pernah hilang, kini ada semula - **sila semak label** |

Jadual **Perubahan sejak muat naik terakhir** menunjukkan Awal &rarr; Hilang &rarr; Akhir
dengan peratus, dan tab ini juga menyenaraikan aset yang paling lama belum diperiksa.
Lajur itu sengaja tidak dipanggil "Diperiksa": halaman ini memerhati **senarai**, bukan
daflar aset.

> **Penting: muat naik senarai PENUH setiap kali.** Jika anda memuat naik sebahagian
> bahagian sahaja, aset yang tiada dalam eksport itu akan tersalah muncul sebagai
> "hilang". Satu eksport penuh bagi setiap pusingan.
>
> **"Muncul semula" ialah amaran, bukan kejayaan.** Aset yang hilang kemudian muncul
> kembali biasanya bermakna labelnya salah taip atau diubah, bukan diperiksa dua kali.

### Simpanan: D1 sahaja (tiada simpanan dalam pelayar)

Rekod **tidak** disimpan dalam pelayar. Tiada `localStorage`, tiada `sessionStorage`,
tiada IndexedDB, dan tiada auto-pulih fail. Sejarah pemeriksaan dan penetapan Bahagian
dibaca daripada D1 melalui Worker.

| Perkara | Kelakuan |
| --- | --- |
| Selepas muat naik | Senarai dihantar ke D1 sebagai satu titik masa |
| Membuka semula halaman | **Kosong** - muat naik semula fail anda; sejarah datang dari D1 |
| Simpanan berkekalan | Dalam jadual D1, dikongsi oleh semua yang membuka alamat Worker |
| Had ruang | Had D1, bukan had pelayar |

> **Kenapa ia dibuang, sedangkan ia berfungsi?** Kerana dua salinan data bermakna dua
> jawapan. Fail yang sama boleh menghasilkan bilangan berbeza pada dua komputer, dan
> mengosongkan cache pelayar memadamkan rekod secara senyap. Simpanan dalam pelayar
> juga tidak boleh dikongsi, jadi setiap pegawai melihat rekodnya sendiri. Satu tempat
> simpanan membetulkan kesemuanya.
>
> **Kosnya, dinyatakan terus:** halaman yang dibuka dengan dua klik (`file://`) tiada
> Worker, jadi **sejarah pemeriksaan** dan **penetapan Bahagian** tidak tersedia di
> sana. Gabung, tapis dan eksport masih berfungsi sepenuhnya - dan panel Sambungan D1
> memberitahu anda keadaan ini dengan jelas, bukan gagal secara senyap.

### Ringkasan Bahagian (tab pertama)

Tab ini menjawab soalan "berapa banyak aset belum diperiksa untuk bahagian X" tanpa
perlu menapis satu per satu:

| Lajur | Maksud |
| --- | --- |
| Bahagian | Nama jabatan / unit |
| Aset Belum Diperiksa | Bilangan aset belum diperiksa (= bilangan label) |
| % | Peratus daripada keseluruhan |
| Bilangan Lokasi | Berapa lokasi berbeza dalam bahagian itu |
| Contoh Lokasi | Tiga lokasi terbesar dengan bilangannya |

Klik mana-mana baris untuk menapis senarai penuh. Dua eksport disediakan:
**CSV ringkasan** (satu baris per bahagian) dan **CSV pecahan penuh**
(bahagian x lokasi).

> **Rekod tanpa Bahagian** disenaraikan sebagai satu baris berasingan dan
> ditandakan. Ia **tidak akan muncul** apabila anda menapis mengikut bahagian, jadi
> lengkapkan medan `Bahagian` dalam sistem sumber.

### Kunci padanan pertindihan

| Pilihan | Bila rekod dikira bertindih |
| --- | --- |
| **Label aset** (disyorkan) | Label aset sama - sesuai kerana setiap aset ada label unik |
| Label aset + Jenis Aset | Kedua-duanya sama |
| Semua medan sama | Hanya jika kesemua enam medan sama tepat |

---

## 3. Deploy ke Cloudflare (satu Worker sahaja)

**Antara muka dibina dengan Preact (melalui `preact/compat`) + Vite + Tailwind + TypeScript.** Komponen dalam
`src/components/`, logik tulen (penapisan, ringkasan, eksport) dalam `src/lib/`, keadaan dan
semua panggilan ke Worker dalam `src/state/`. Vite membungkusnya menjadi aset berhash yang
dicache selama-lamanya.

Seluruh `src/` ialah TypeScript (`tsc --noEmit` bersih, dipanggil oleh `npm run check` dan
`npm run verify`). Kontrak yang paling mahal apabila ia tersasar ialah rekod aset, bentuk API
Worker (termasuk format padat `{ fields, rows }`), keadaan aplikasi, dan kesan yang
mengubahnya - kesemuanya dinyatakan dalam `src/types.ts`, bukan hanya dalam prosa. Bentuk
`window.__uiHarness__` diperoleh daripada pelaksanaannya sendiri
(`ReturnType<typeof buildHarness>` dalam `src/harness.ts`), jadi ia tidak boleh tersasar
daripada apa yang benar-benar didedahkan. Empat perkara **sengaja kekal JavaScript**:
`src/parser.mjs` (dikongsi dengan `tools/` dan `tests/`, disahkan oleh 187 ujian; bentuknya
dinyatakan oleh `src/parser.d.ts`), serta `tools/`, `tests/` dan `cloudflare/` (semuanya
berjalan di bawah Node, bukan dalam pelayar).

**Satu Worker melakukan kedua-dua kerja**, jadi tiada dua perkhidmatan untuk
diselaraskan:

| Laluan | Dihidangkan oleh | Mengapa |
| --- | --- | --- |
| `/` | `public/index.html` | Cangkerang kecil yang menamakan aset berhash |
| `/assets/app.<hash>.js` `.css` | Fail statik | Kod aplikasi, dicache selama-lamanya oleh pelayar |
| `/api/*` | Kod Worker + **D1** (SQLite) | Supaya semua orang melihat rekod yang sama |

Fail statik dijawab terus tanpa membangunkan Worker, jadi halaman itu pantas; hanya
panggilan API masuk ke kod di bawah. Permintaan untuk fail statik **percuma dan tanpa
had** pada pelan Free Cloudflare - yang dikira hanya permintaan yang sampai ke kod
Worker.

### Muatan yang dipecahkan (dan sebabnya)

Halaman yang di-deploy dahulunya **satu fail 188 KB**, 88% daripadanya satu blok
skrip. Diukur pada deployment sebenar, fail itu tiba dengan
`cache-control: public, max-age=0, must-revalidate` **tanpa ETag atau Last-Modified** -
jadi pelayar tiada apa-apa untuk disahkan, dan ia memuat turun semula keseluruhan
188 KB pada **setiap** lawatan, sekali gus menghurai semula 166 KB JavaScript.

Sekarang `npm run build` memecahkannya, dan nama fail aset mengandungi hash
kandungannya sendiri (jadi URL itu tidak boleh berubah) dengan `_headers` memberi
kebenaran cache selama-lamanya:

| Fail | Saiz (mentah) | Cache |
| --- | --- | --- |
| `index.html` (cangkerang) | **379 bait** | sentiasa disahkan semula - ia yang menamakan hash semasa |
| `assets/app.<hash>.js` | 295.5 KB | `immutable, max-age=31556952` |
| `assets/app.<hash>.css` | 22.2 KB | `immutable, max-age=31556952` |

**Diukur dalam pelayar sebenar terhadap deployment ini (React, terpecah):**

| | Sebelum (satu fail) | Selepas |
| --- | --- | --- |
| Lawatan pertama (pindahan) | 44 KB (HTML, tiada ETag) | 111.7 KB (0.6 KB cangkerang + 5.8 KB CSS + 98.8 KB JS + 6.5 KB API) |
| **Lawatan ulangan** | **44 KB setiap kali** | **590 bait** (cangkerang sahaja; JS, CSS dan API dijawab dari cache) |
| Panggilan API semasa buka | 6-7 (2 gelombang) | 1-2 (`/api/bootstrap`, dan `/api/current` untuk pembaca) |

Lawatan ulangan turun **~99%**. Kosnya jujur: lawatan pertama menjadi lebih berat kerana
React (~45 KB) - itulah harga yang dibayar untuk struktur komponen, dan ia dibayar sekali
sahaja setiap pelawat, bukan setiap lawatan.

> **Kenapa Preact?** Sumber kekal menulis `import ... from 'react'`; Vite (`@preact/preset-vite`)
> dan `paths` dalam `tsconfig.json` memetakannya ke `preact/compat`. Bundle JS jatuh daripada
> 331.7 KB (gzip 103 KB) dengan React kepada 123.3 KB (gzip 41 KB). Angka React di atas ialah
> ukuran lama.
>
> **Kenapa React (dahulu)?** Bukan kerana kelajuan - angka di atas menunjukkan ia menambah ~45 KB
> pada lawatan PERTAMA, dan tidak mengurangkan bilangan panggilan API atau baris yang dibaca
> D1. Ia dipilih untuk **penyelenggaraan kod**: 2,742 baris dalam satu fail HTML menjadi
> komponen bernama, dan suite ujian yang sama memaksa tingkah laku itu kekal. Yang
> mengurangkan masa muat ialah cache dan bentuk muatan - kedua-duanya dilakukan di sini,
> dan kedua-duanya boleh diukur.
>
> **Kenapa `public/` dan bukan `dist/`?** `dist/` ialah folder kerja: ia memuatkan
> hasil utama **dan** harness ujian kendiri serta halaman sementara yang ditulis oleh
> alat pengesahan - sebahagiannya membenamkan fail sumber sebenar. `npm run build`
> menulis semula `public/` dan **memeriksa** isinya: hanya `index.html`, `_headers`
> dan `assets/app.<hash>.{js,css}` yang dibenarkan, jadi tiada artifak ujian boleh
> terlepas ke internet. `npx wrangler deploy --dry-run` akan melaporkan
> `Read 5 file(s) from the assets directory`.

### Langkah deploy

```bash
npm run build                          # tulis public/ (cangkerang + aset berhash)
npm run cf:d1:create                   # sekali sahaja: cipta D1 "aset-pks"
#   salin "database_id" yang dicetak ke cloudflare/wrangler.toml
npm run cf:deploy                      # bina, kemudian deploy Worker
npm run cf:smoke                       # uji deployment sebenar melalui HTTPS
```

### Deployment semasa

| Perkara | Nilai |
| --- | --- |
| URL | `https://aset-pks.wilsonintai76.workers.dev` |
| Pangkalan data D1 | `aset-pks`, id `54614215-c7d2-4a1a-8fee-5fd0fdb233de` (APAC) |
| Akun Cloudflare | `wilsonintai76@gmail.com` |
| Kawalan akses | `ACCESS_MODE = "password"` - bacaan awam, **tulisan perlu log masuk admin** (rahsia `ADMIN_PASSWORD`) |

`npm run cf:smoke` menguji URL itu seperti pengguna sebenar: halaman disajikan,
artifak ujian **tidak** diterbitkan, D1 benar-benar terikat, senarai boleh dibaca tanpa
log masuk, dan **tulisan tanpa log masuk ditolak pada kedua-dua awalan `/api/*` dan
`/api/admin/*`**. Dalam mod `trusted` sahaja ia menjalankan kitaran penuh tulis &rarr;
baca &rarr; padam, dan ia sentiasa memadam rekod ujiannya sendiri - jadi ia boleh
dijalankan pada pangkalan data langsung tanpa meninggalkan sisa.
Perkara yang hanya boleh dibuktikan dengan deploy - binding D1, saiz muatan, aset
statik - disahkan di sana, bukan oleh shim tempatan.

> **Nota keselamatan:** URL di atas boleh dibuka oleh sesiapa yang mempunyai pautan itu,
jadi **senarai itu mesti dianggap awam**. Yang dilindungi ialah *tulisan*: tiada sesiapa
boleh memuat naik, memadam titik masa atau menukar tetapan Bahagian tanpa log masuk admin.
Sesiapa yang membuka halaman itu tanpa log masuk melihat senarai itu sahaja, dan tiap-tiap
percubaan menulis dijawab 401 oleh Worker - bukan disembunyikan oleh butang.

Selepas itu buka `https://aset-pks.<akaun>.workers.dev`. Itu sahaja - tiada
`pip install`, tiada bekas, tiada pangkalan data untuk dipasang, dan tiada
pemasangan pada komputer pengguna.

> Worker ini juga boleh dijalankan tanpa D1 jika anda mahu halaman sahaja: padamkan
> blok `[[d1_databases]]` dan aplikasi akan berjalan dalam **mod luar talian**
> (data disimpan dalam pelayar). Semua ciri gabung, tapis dan eksport kekal berfungsi.

### Jika halaman dihosting di tempat lain

Aplikasi ini boleh menunjuk ke API pada asalan berbeza. Tambah atribut pada elemen
`<html>`:

```html
<html lang="ms" data-api="https://aset-pks.<akaun>.workers.dev">
```

Tanpa `data-api`, halaman menggunakan asalan yang sama - itulah yang berlaku apabila
Worker menghidangkan halaman dan API sekali.

### Log masuk admin

Empat mod, dan perbezaannya ialah **siapa yang boleh menulis** dan **bagaimana dia
membuktikannya**:

| `ACCESS_MODE` | Log masuk | Siapa boleh menulis | Gunakan bila |
| --- | --- | --- | --- |
| **`password`** (lalai sekarang) | kotak log masuk pada halaman, kata laluan disemak Worker | sesiapa yang tahu `ADMIN_PASSWORD` | Satu admin, satu kata laluan - tiada persediaan Cloudflare |
| `enforce` | Cloudflare Access pada `/api/admin` | e-mel dalam `ADMIN_EMAILS` | Pasukan, dan bila setiap tulisan perlu boleh dikaitkan dengan seseorang |
| `open` | tiada | **tiada sesiapa** | Deployment awam sebelum log masuk disediakan |
| `trusted` | tiada | sesiapa yang boleh membuka URL | Salinan peribadi yang internet tidak boleh capai |

**Cara pembaca menjadi admin (mod `password`).** Pembaca tidak nampak Langkah 1 dan
Langkah 2 - mereka membaca senarai itu sahaja. Pada tab **Senarai Semasa** ada butang
**Muat naik senarai**; menekannya membuka kotak **Log masuk admin**, kerana memuat naik
menukar apa yang dilihat oleh *semua* orang:

| Keadaan | Yang berlaku |
| --- | --- |
| Kata laluan salah | Kotak itu kekal terbuka, ralat dipaparkan, peranan tidak berubah |
| Kata laluan betul | Worker menghantar kuki `HttpOnly` yang ditandatangani (HMAC); halaman membaca semula `/api/bootstrap` dan **dashboard admin muncul** - Langkah 1 dengan pemilih `.xls`/`.csv`, Langkah 2, dan tab diagnosis |
| Admin menekan **Log keluar** | Kuki dibuang dan paparan kembali awam |
| Rahsia belum ditetapkan | Kotak itu berkata begitu dan menawarkan **Tutup** sahaja - tiada medan kata laluan, kerana medan yang tidak boleh berjaya adalah ciri palsu |

> **Apa yang TIDAK memerlukan log masuk: membaca.** Butang **Muat semula** (tab Senarai
> Semasa dan tab Sejarah), tapisan, carian, ringkasan dan semua eksport terbuka kepada
> semua orang - ia membaca D1, dan bacaan memang awam. Yang memerlukan log masuk hanya
> satu perkara: **menghantar** senarai baharu ke D1. Sebab itu "Muat semula" berfungsi
> walaupun tanpa sesi, dan "Muat naik senarai" tidak.

Kata laluan itu tidak pernah masuk ke keadaan aplikasi dan tidak pernah dipulangkan oleh
Worker: ia dibandingkan dengan rahsia itu dalam **masa tetap** (kedua-dua belah di-hash
dahulu, jadi perbandingan itu tidak mendedahkan panjang atau bait yang berbeza), dan
yang keluar hanya kuki sesi. Kuki itu ditandatangani dengan kunci yang **diperoleh daripada
kata laluan itu sendiri**, jadi menukar kata laluan membatalkan semua sesi lama, dan
kuki yang diubah, ditandatangani dengan kunci lain, atau sudah lupus ditolak (kesemuanya
diuji dalam `npm run cf:test`). Tempoh sesi ialah 12 jam.

```bash
# Sekali sahaja. Ia bertanya nilai itu di terminal anda, bukan dalam sembang.
npx wrangler secret put ADMIN_PASSWORD --config cloudflare/wrangler.toml
npm run cf:smoke        # 34 pemeriksaan, termasuk mod yang dilaporkan
```

> Dalam mod `password` kesan yang dicatat ialah **"admin"**, bukan alamat e-mel - tiada
> identiti per orang. Jika beberapa orang perlu memuat naik, atau anda perlu tahu *siapa*
> yang memuat naik, gunakan mod `enforce` di bawah dan biarkan Cloudflare Access yang
> mengenal pasti setiap orang.

### Mengaktifkan log masuk admin (Cloudflare Access, alternatif)

Dalam keempat-empat mod, **bacaan adalah awam** (kecuali `trusted`, yang juga awam).
Worker hanya boleh mengasingkan admin daripada pembaca kalau ia tahu **siapa** yang
memanggil. Cloudflare Access melakukan bahagian itu, dan Worker mengesahkan tokennya
(tandatangan RS256 terhadap kunci awam Access, serta `aud`, `iss` dan `exp`) sebelum
mempercayai sebarang e-mel. Tandatangan itu yang menjadikan peranan itu benar - header
yang dipalsukan tidak bernilai apa-apa.

> **Aplikasi Access dilindungi pada LALUAN, bukan hosname.** Ia mesti meliputi
> `aset-pks.wilsonintai76.workers.dev/api/admin` sahaja. Jika ia meliputi seluruh
> hosname, pembaca awam akan diminta log masuk sebelum melihat senarai awam - iaitu
> tepat apa yang reka bentuk ini elakkan.

**Cara paling cepat - satu skrip.** Login `wrangler` boleh **membaca** Access tetapi
**tidak boleh mencipta** (ia menjawab `403 auth.forbidden`), jadi penciptaan perlukan
token dengan kebenaran **Access: Apps and Policies: Edit**:

1. Cloudflare dashboard &rarr; **My Profile &rarr; API Tokens &rarr; Create Token &rarr;
   Custom token**. Benarkan **Account &rarr; Access: Apps and Policies &rarr; Edit**.
2. Simpan token itu ke fail. **Jangan** tampalkan token ke dalam sembang:

   ```powershell
   Set-Content -Path "$env:USERPROFILE\.cf-access-token" -Value "<token>" -NoNewline
   ```

3. Lihat pelan dahulu, kemudian jalankan:

   ```bash
   npm run cf:access -- --token-file "%USERPROFILE%\.cf-access-token" --dry-run
   npm run cf:access -- --token-file "%USERPROFILE%\.cf-access-token"
   npm run cf:deploy
   npm run cf:smoke
   ```

Skrip itu mencipta aplikasi Access **pada laluan `/api/admin`** dan polisinya, membaca
**AUD tag** dan **team domain**, menulis keempat-empat pemboleh ubah ke
`cloudflare/wrangler.toml`, dan selamat dijalankan dua kali (aplikasi yang sudah ada
digunakan semula). Ia juga memberitahu jika aplikasi lama masih melindungi **seluruh**
hosname, kerana itu akan memaksa pembaca awam log masuk.

Secara lalai hanya admin dibenarkan masuk, kerana pembaca tidak memerlukan akaun.
Laraskan dengan `--admin a@b,c@d`; `--allow-domain poliku.edu.my` menambah kakitangan
yang boleh log masuk (mereka masih hanya boleh membaca).

**Cara manual** (jika anda lebih suka klik):

1. **Zero Trust &rarr; Access &rarr; Applications &rarr; Add an application &rarr;
   Self-hosted.** Isi hosname Worker
   (`aset-pks.wilsonintai76.workers.dev`) **dan setkan laluan kepada `/api/admin`** -
   medan Path dalam borang yang sama. Ini yang melindungi tulisan tanpa menyekat
   senarai awam.
2. Tambah polisi **Allow** dengan e-mel admin (`wilsonintai76@gmail.com`).
3. Salin **Application Audience (AUD) Tag** dan **team domain** ke
   `cloudflare/wrangler.toml`, dan tukar `ACCESS_MODE` kepada `enforce`.
4. `npm run cf:deploy`, kemudian `npm run cf:smoke`.

Selepas itu halaman itu sendiri yang memaklumkan keadaan: pembaca melihat nota
"log masuk sebagai admin untuk memuat naik" bersama butang **Admin log masuk**, dan
admin yang sudah log masuk melihat e-melnya serta pautan **Log keluar**.

> **`ADMIN_EMAILS` sudah diisi** (`wilsonintai76@gmail.com`), jadi beralih kepada
> `enforce` tidak boleh mengunci pemilik keluar. Kalau senarai itu kosong semasa
> `enforce`, Worker menolak **semua** tulisan dan memberitahu mengapa - gagal secara
> tertutup, bukan terbuka.
>
> **Semasa `ACCESS_MODE = "open"`** (keadaan sekarang) tiada log masuk wujud, jadi
> setiap tulisan ditolak. Halaman menyatakannya dengan jelas pada panel Sambungan D1
> ("Log masuk admin belum disediakan"), dan `npm run cf:smoke` juga begitu - ia betul
> untuk deployment awam yang belum disediakan, dan salah jika anda mengharapkan admin
> boleh menulis.

### Mengesahkan Worker tanpa deploy

```bash
npm run cf:test      # 124 pemeriksaan terhadap SQLite sebenar melalui shim D1
```

> **Had yang jujur:** `wrangler dev` memerlukan binari `workerd`, yang **gagal
> dimulakan pada mesin ini** (ia tidak dapat mencipta direktori kerjanya di dalam
> folder OneDrive yang disegerakkan). Itu masalah persekitaran, bukan kod. Untuk
> mengelakkan SQL Worker langsung tidak diuji, `cloudflare/d1-shim.mjs` menjalankan
> pengendali `fetch` Worker terhadap SQLite sebenar melalui pemacu `node:sqlite`.
>
> Ini mengesahkan **logik dan SQL** Worker, serta cabang fail statik (dengan binding
> palsu). Ia **tidak** mengesahkan kelakuan D1 sebenar - had saiz, konsistensi,
> cold start - yang memerlukan `wrangler deploy`.

---

## 4. Struktur projek

```text
senarai-aset-merge/
  dist/
    Laporan_Aset_Belum_Diperiksa_PKS.html   bentuk yang SAMA seperti yang di-deploy
    assets/                                 salinan aset berhash (untuk suite dan cakera)
  public/
    index.html        cangkerang yang Worker deploy (381 bait; kod ada dalam assets/)
    assets/           app.<hash>.js dan app.<hash>.css
    _headers          beri aset berhash kebenaran cache selama-lamanya
  src/
    index.html        templat cangkerang (Vite menggantikan <script> dengan aset)
    main.tsx          titik masuk: pasang Preact, eksport __uiHarness__
    App.tsx           susun atur halaman dan peraturan peranan
    styles.css        Tailwind: token dalam @theme, kelas komponen dalam @layer components
    types.ts          kontrak yang dikongsi: rekod aset, bentuk API, keadaan aplikasi
    parser.mjs        enjin penghuraian + penggabungan (dikongsi dengan tools/ dan tests/)
    parser.d.ts       bentuk src/parser.mjs yang diperiksa oleh TypeScript
    lib/
      api.ts          semua panggilan ke Worker (bootstrap, tulisan melalui /api/admin)
      compute.ts      logik tulen: gabung, tapisan, ringkasan, model sejarah, format
      exports.ts      CSV / JSON / Excel daripada baris yang dilihat
    state/
      reducer.ts      keadaan aplikasi sebagai transisi, bukan tugasan bertaburan
      AppProvider.tsx pengawal: keadaan + setiap kesan sampingan D1
      notices.ts      mesej sebagai data (tiada rentetan HTML, jadi tiada suntikan)
    components/
      ui.tsx          Panel, DataGrid, Pager, Notice, Cards, DebouncedSearch
      Header.tsx LinkPanel.tsx DropZone.tsx OptionsPanel.tsx AssignPanel.tsx
      ResultPanel.tsx LoginDialog.tsx (kotak log masuk admin)
      tabs/           satu fail bagi setiap paparan Langkah 3 (SummaryTab, HistoryTab,
                      MergedTab, DupesTab, ConflictsTab, SourcesTab) + index.ts
    harness.ts        window.__uiHarness__ - kontrak yang digunakan oleh lima suite
    static/_headers   disalin oleh Vite ke public/
  tests/
    run-tests.mjs     suite regresi JavaScript (187 ujian)
  tools/
    build-app.mjs     jalankan Vite, semak public/, salin bentuk yang sama ke dist/
    check-built-app.mjs pastikan sumber ASCII dan binaan benar-benar terpecah
    merge-files.mjs   gabung melalui baris perintah
    verify-ui.mjs     uji aplikasi dalam pelayar sebenar (gabung, tapis, eksport)
    verify-storage.mjs buktikan tiada apa-apa disimpan dalam pelayar
    verify-history.mjs uji tab sejarah dirender daripada data D1
    verify-assign.mjs uji penetapan Bahagian disimpan dalam D1
    verify-viewer.mjs uji skrin pembaca awam: pautan log masuk, penolakan tulis
    verify-deployed.mjs uji Worker yang telah di-deploy (HTTPS)
    fake-d1.mjs       API tiruan untuk suite pelayar (data terkawal)
    scenario-test.mjs uji pada saiz data sebenar (473 + 63)
    synthetic-data.mjs jana fail contoh pada saiz sebenar
    integrity-check.mjs semak integriti fail sebenar
    delta-demo.mjs    tunjuk kiraan perubahan pada data contoh
    shot-assign.mjs   ambil tangkapan skrin panel
    mine-expected.mjs periksa fail dan cetak ringkasan
  contoh-output/
    Contoh_Gabungan_536_Aset.xls / .csv   (data sintetik)
  cloudflare/
    worker.js         halaman statik + API + D1 (keseluruhan backend)
    d1-shim.mjs       jalankan Worker terhadap SQLite sebenar untuk ujian
    verify-worker.mjs suite ujian Worker
    wrangler.toml     konfigurasi deploy (fail statik + binding D1)
    package.json      pin wrangler untuk kerja deploy
  package.json
```

`src/parser.mjs` ialah **satu-satunya sumber logik penghuraian**. Aplikasi mengimpornya
sebagai modul, dan `tools/` serta `tests/` mengimpornya terus - jadi aplikasi pelayar dan
suite ujian menjalankan kod yang **sama tepat**, tanpa salinan kedua yang boleh mula berbeza
secara senyap.

### Nota penyelenggaraan (perkara yang tidak jelas dari kod)

Empat perkara ini pernah menjadi kegagalan sebenar semasa penukaran kepada komponen. Ia
disimpan di sini supaya tidak ditemui semula:

1. **Skrip dalam cangkerang mesti skrip KLASIK, di hujung `<body>`.** Suite mengesahkan
   tingkah laku dengan menyuntik stub SEBELUM aplikasi dan harness mereka SELEPASNYA, dan ia
   bergantung pada susunan dokumen. `type="module"` sentiasa ditangguhkan, jadi ia akan
   berjalan selepas harness. Vite membina dengan `format: 'iife'` dan `build-app.mjs`
   menulis semula tag itu.
2. **`public/_headers` menggunakan `#` untuk komen, bukan `/* */`.** Komen gaya-C dibaca
   sebagai peraturan URL diikuti header yang tidak sah, dan **deploy gagal** - dengan mesej
   yang tidak menyebut nama fail itu.
3. **Jangan benamkan bundle ke dalam HTML.** Sumber React sendiri mengandungi rentetan
   `<!--` dan `<script>`; apabila diselitkan, penghurai HTML masuk ke keadaan "escaped" dan
   tag penutup berhenti menutup.
4. **Kotak carian menggunakan `onInput`, bukan `onChange`.** React melangkau `onChange`
   apabila nilai ditetapkan secara program (itulah cara suite "menaip"), kerana penjejak
   nilai yang dipasang pada elemen itu melihat nilai yang sama.

Dua lagi perkara tentang tingkah laku, bukan sintaks:

- **Muat naik menunggu probe selesai.** Sebelum `d1.checked` menjadi benar, halaman tidak
  tahu sama ada ia bersambung; memberitahu pengguna "tidak disimpan" pada saat itu adalah
  tuduhan yang belum disahkan.
- **Selepas setiap tulisan, halaman membaca semula dengan nonce (`?t=...`)** supaya cache
  kongsi tidak menyajikan senarai pra-tulisan kepada admin yang baru memuat naik.

Tiga perkara tentang TypeScript, kerana semuanya boleh memecahkan binaan tanpa amaran:

- **Import relatif dalam `src/` mesti TANPA sambungan** (`'../lib/compute'`, bukan
  `'../lib/compute.ts'`). `moduleResolution: bundler` menerima kedua-duanya, tetapi Vite
  membina bundle yang berbeza - dan nama berhash dalam `public/` mesti sepadan dengan apa
  yang diuji oleh suite dan apa yang di-deploy.
- **`src/parser.d.ts` ialah bentuk `src/parser.mjs` yang diisytiharkan.** Jika parser itu
  ditukar kepada TypeScript, **hapus fail itu**; jika tidak, TypeScript akan terus memakai
  isytiharannya dan perbezaan sebenar menjadi senyap. Jangan ulang jenis yang sudah ada
  dalam `src/types.ts` - dua salinan akan bersetuju hari ini dan tersasar kemudian.
- **`src/types.ts` ialah satu-satunya tempat kontrak ditakrifkan.** Sebelum migrasi, bentuk
  API Worker dan `window.__uiHarness__` hanya wujud dalam prosa; suite pelayar membaca DOM
  melalui nama kelas (`.notice.warn`, `table.data-grid`, `.card .k`), jadi nama itu adalah
  sebahagian daripada kontrak, bukan gaya. Bentuk `__uiHarness__` diperoleh daripada
  `src/harness.ts`, jadi ia tidak boleh tersasar daripada apa yang didedahkan.

---

## 5. Arahan pembangunan

Memerlukan Node.js 20.19+ (Vite 7; `engines` dalam `package.json` menyatakannya) dan
`npm install` sekali. `npm run cf:test` memerlukan Node 22.5+ kerana ia menggunakan
`node:sqlite`.

```bash
npm run typecheck # tsc --noEmit sahaja - 0 ralat diperlukan sebelum apa-apa di-deploy
npm run check     # typecheck + semak sumber ASCII + binaan benar-benar terpecah dan boleh dicache
npm test          # ujian regresi enjin penghuraian dan pengambilan fail (241)
npm run build     # Vite membungkus -> public/ + dist/, kemudian menyemaknya
npm run verify    # typecheck + check + ujian, kemudian bina
npm run dev:app   # pelayan pembangunan Vite (proksi /api ke Worker sebenar)
npm run scenario  # uji pada saiz sebenar: 473 + 63 label
npm run ui        # gabung, tapis dan eksport dalam pelayar sebenar
npm run storage   # buktikan halaman tidak menyimpan apa-apa dalam pelayar
npm run history   # tab sejarah dirender daripada data D1
npm run assign    # penetapan Bahagian disimpan dalam D1
npm run viewer    # skrin pembaca awam: senarai D1, pautan log masuk, tulis ditolak
npm run drop      # laluan 'lepaskan fail': sekali sahaja, dan dari folder mana
npm run cf:test   # uji Worker terhadap SQLite sebenar (184 pemeriksaan)
npm run cf:smoke  # uji Worker yang telah di-deploy, melalui HTTPS
```

Kerja Cloudflare (jalankan `npm install` sekali untuk memasang wrangler):

```bash
npm run cf:d1:create   # sekali sahaja: cipta pangkalan data D1
npm run cf:deploy      # bina, kemudian deploy Worker
npm run cf:dev         # Worker tempatan (lihat amaran workerd di seksyen 3)
npm run cf:tail        # ikut log Worker yang telah di-deploy
```

---

## 6. Rekod kekal dan dikongsi (D1)

Fail HTML tunggal itu sesuai untuk **seorang pengguna**. Jika beberapa pegawai perlu
melihat rekod yang **sama**, atau rekod mesti **kekal walaupun cache pelayar
dipadamkan**, gunakan Worker + D1 seperti di seksyen 3. Tiada apa-apa untuk dipasang
pada komputer pengguna - mereka hanya membuka alamat Worker.

### Apa yang berlaku

Imej dan bekas tiada kaitan di sini: tiada apa-apa untuk dibina selain fail statik.

| Perkara | Di mana ia berlaku |
| --- | --- |
| Menghurai fail `.xls`, gabung, kira perubahan | Dalam pelayar |
| Menyimpan pemerhatian dan menjawab pertanyaan | Worker + D1 |
| Rekod kekal | Jadual D1 (`observation_assets`, `observations`, `dept_snapshots`) |

Aplikasi itu sendiri **sama** dalam kedua-dua mod. Bila anda membukanya melalui Worker,
ia mengesan `/api/bootstrap` dan memaparkan **"Worker disambung"**; dari cakera (`file://`)
ia memaparkan **"Mod luar talian"**. Tiada tetapan untuk ditukar.

### Pembahagian tugas - dan sebabnya

Penghurai fail `.xls` itu hidup dalam `src/parser.mjs` dan **dikongsi** dengan aplikasi
pelayar. Fail itu JavaScript, disahkan oleh 187 ujian. Daripada menyalinnya ke Worker
(di mana dua salinan akan mula berbeza secara senyap), **pelayar menghurai dan Worker
menyimpan**:

```text
pelayar   menghurai fail .xls yang rosak, gabung, kira perbezaan
Worker    simpan pemerhatian itu secara kekal dan jawab pertanyaan
```

Kesannya: endpoint muat naik menerima **rekod**, bukan fail mentah.

### Jadual D1

Worker mencipta jadual ini sendiri pada panggilan API pertama - tiada migrasi untuk
dijalankan, dan tiada fail pangkalan data untuk dijaga.

| Jadual | Kandungan |
| --- | --- |
| `observations` | Satu baris per muat naik (titik masa), dengan masa dan bilangan aset |
| `observation_assets` | Label yang hadir dalam setiap titik masa, dengan butiran aset |
| `dept_snapshots` | Bilangan aset setiap bahagian pada setiap titik masa |
| `bahagian_overrides` | Tetapan Bahagian manual, disimpan mengikut **label** aset |
| `manual_figures` | Tiga angka daftar yang disalin oleh admin (**Total aset**, **Sudah diperiksa**, **Belum diperiksa**) daripada ringkasan Sistem Pengurusan Aset Alih, satu baris sahaja |

### Setiap muat naik menggantikan SELURUH senarai

Fail yang dimuat naik **ialah** senarai aset yang belum diperiksa - itulah yang dieksport oleh
sistem sumber. Jadi muat naik tidak perlu digabungkan dengan apa-apa: ia **menggantikan**
senarai semasa, dan aset yang tidak lagi ada dalamnya ialah aset yang sudah diperiksa sejak
kali terakhir.

> **Muat naik fail yang lengkap.** Sebab peraturan ini dipilih: satu eksport boleh jadi
> sebahagian sahaja - sebahagian baris tiada `Bahagian`, dan aset satu bahagian boleh tersebar
> dalam beberapa helaian atau fail. Kalau muat naik dianggap "inilah bahagian-bahagian yang
> saya sebut sahaja", maka satu fail yang tidak menyebut sesuatu bahagian akan menyimpan
> bahagian itu daripada dikira sebagai sudah diperiksa - dan sebaliknya, satu fail separuh
> akan menamatkan bahagian yang tiada di dalamnya. Peraturan yang tidak boleh salah ialah:
> **muat naik semuanya, dapatkan senarai baharu.**

| Langkah | Apa yang D1 simpan |
| --- | --- |
| Admin memuat naik eksport | Satu **titik masa baharu**, dan itulah senarai semasa |
| Aset yang tiada dalam senarai baharu | Ditandakan **"Sudah diperiksa"** (itulah maksud "hilang dari senarai") |
| Aset yang muncul dalam eksport baharu | Ditandakan **baharu**, dan muncul dalam senarai belum diperiksa |
| Muat naik yang *sama tepat* dengan senarai terakhir | Ditolak **409** dan tiada titik masa dicipta - muat naik semula fail yang sama tidak menggelembungkan apa-apa |
| Fail yang **dibetulkan** - label sama, satu `Bahagian` diubah dalam sistem sumber | **Diterima** sebagai titik masa baharu (inilah cara pembetulan sampai ke D1) |
| Muat naik yang tersilap | **Padam** titik masa itu dalam tab Sejarah; titik masa sebelumnya kembali menjadi semasa |
| Nak mula dari kosong | **Padam semua titik masa** (admin sahaja) - kotak pengesahan menyebut bilangannya dulu, dan tetapan Bahagian manual tidak diubah |

Titik masa lama **tidak** dibuang: hanya senarai semasa yang digantikan. Sejarah, jadual
perubahan dan kadar kemajuan datang daripada titik-titik masa itu, jadi jika satu muat naik
tersilap, padam titik masa itu dan senarai sebelum ini kembali menjadi semasa.

Sebabnya: "belum diperiksa" dan "sudah diperiksa" **bukan** keadaan dalam fail - ia
perbandingan antara dua senarai. Jadi aliran kerja yang betul ialah:
eksport &rarr; muat naik &rarr; halaman melaporkan "X aset hilang, Y aset baharu".

### Apabila eksport berbeza daripada daftar aset - dan cara ia disemak

Aplikasi ini ada satu kerja: **menjejaki aset yang belum diperiksa**. Setiap fail yang
dimuat naik ialah senarai aset yang masih belum diperiksa, dan itulah **kiraan fail**.

Tiga angka lain **tidak boleh dikira daripada muat naik**: eksport tidak memberitahu berapa
banyak aset yang dipegang institusi, berapa banyak yang sudah diperiksa, atau berapa banyak
yang daftar sendiri kata masih belum diperiksa. Ketiga-tiganya disalin daripada **ringkasan
Sistem Pengurusan Aset Alih** oleh admin (butang **Kemas kini angka** pada tab Sejarah) dan
disimpan dalam D1.

**Angka SPAA "belum diperiksa" itulah kunci penyemakan.** Ia dipaparkan pada kad sebagai
angka laporan, dan kiraan fail diletakkan di sebelahnya. Jika kedua-duanya berbeza, tab
Sejarah menunjukkan panel **beza SPAA-dengan-fail**:

> **Angka SPAA berbeza dengan fail: beza 6 644 aset** - SPAA kata 6 984 aset masih belum
> diperiksa, tetapi fail terakhir menyenaraikan 340. Kemungkinan fail yang dimuat naik itu
> **bukan senarai penuh** - semak sama ada semua bahagian dan semua helaian sudah dieksport -
> atau angka SPAA perlu dikemas kini.

Dua pemeriksaan yang berbeza maksudnya, dan kedua-duanya perlu ada:

| Pemeriksaan | Antara | Maksud beza |
| --- | --- | --- |
| Aritmetik daftar (`#figuresMismatch`) | Total aset vs (sudah + belum diperiksa) | **Salah salin.** Ketiga-tiganya datang daripada satu ringkasan, jadi ia sepatutnya menambah |
| SPAA lawan fail (`#figuresFileGap`) | Angka SPAA vs kiraan fail | **Fail tidak lengkap, atau daftar sudah basi.** Ini perbezaan sebenar, bukan kesilapan menaip |

Muat naik **tidak ditolak** kerana beza itu - merekod senarai separuh kadang-kadang betul -
tetapi bezanya disebut dengan angka yang jelas, supaya ia tidak boleh berlalu tanpa disedari.

| Peraturan | Mengapa |
| --- | --- |
| Angka daftar **tidak pernah direka** | Selagi admin belum menyalinnya, kad itu menunjukkan "**-  belum ditetapkan**" dan tab Sejarah menggesa supaya ia disetkan. Kiraan halaman sendiri (setiap label yang pernah dilihat D1) hanya muncul dalam tooltip dan dalam dialog, **tidak** sebagai jawapan |
| **Kiraan fail tidak pernah diedit** | Ia fakta tentang fail terakhir. Yang boleh disalin ialah angka daftar, dan kedua-duanya dipaparkan bersebelahan - bukan salah satu menggantikan yang lain |
| Angka daftar **kekal** selepas muat naik baharu | Pembetulan itu satu keputusan, bukan pemerhatian - muat naik seterusnya tidak sepatutnya memadamnya |
| **Kosongkan angka daftar** membuang ketiga-tiganya | Kad kembali kepada "belum ditetapkan", kiraan fail kembali memimpin kad, dan tarikh kemas kini jatuh kembali kepada muat naik terakhir |
| Aritmetik daftar **ditunjukkan hidup-hidup** | Dalam dialog, sebelum disimpan: sepadan atau beza, kedua-duanya dinyatakan |
| Kad kelima ialah **tarikh** kemas kini terakhir | Ia dahulunya mengulangi bilangan "sudah diperiksa"; tarikhnya ialah muat naik terakhir atau pindaan angka daftar, yang mana lebih baru |

> **Angka "diperiksa" dalam jadual kemajuan tetap berbeza.** Jadual *Kemajuan sejak
> pemeriksaan terakhir* mengira label yang **hilang** antara dua muat naik. Itu pemerhatian
tentang senarai, bukan angka daftar, jadi ia tidak ditukar - tetapi kedua-duanya boleh
berbeza, dan itu memang dijangka.

Saiz pula bukan masalah: satu titik masa = satu baris dalam `observations` + satu baris
setiap aset. 536 aset × 52 muat naik mingguan dalam setahun &asymp; 28 ribu baris - jauh di
bawah had D1 percuma.

> **Perbezaan "409" itu penting.** Pemeriksaan muatan berulang membandingkan **kandungan**
> titik masa (label + Jenis Aset + Pegawai + Bahagian + Lokasi), bukan set label sahaja.
> Jika ia membandingkan label sahaja, fail yang *dibetulkan* - aset yang sama, satu
> `Bahagian` dibaiki dalam sistem sumber - akan ditolak sebagai "sudah ada", dan pembetulan
> itu tidak akan pernah sampai ke D1. Susunan baris dalam fail tidak dikira.
>
> **Kosongkan semula adalah manual, bukan automatik.** "Reset setiap kali muat naik" tidak
> dilakukan: selepas reset tiada apa-apa untuk dibandingkan, jadi setiap aset kelihatan
> belum diperiksa. Jika anda benar-benar mahu bermula kosong (selepas ujian, contohnya),
> butang **Padam semua titik masa** dalam tab Sejarah melakukan tepat itu - admin sahaja,
> di belakang kotak pengesahan yang menyebut bilangan titik masa dan rekod aset yang akan
> dibuang.

### Sandaran dan pemulihan

Rekod kini hidup dalam D1, bukan dalam bekas. Untuk menyimpan salinan:

```bash
npx wrangler d1 export aset-pks --remote --output aset-backup.sql
npx wrangler d1 execute aset-pks --remote --command "SELECT COUNT(*) FROM observations"
```

Pulihkan dengan `npx wrangler d1 execute aset-pks --remote --file aset-backup.sql`.

### API

**Bacaan adalah awam** dan hidup di `/api/*`. **Tulisan hidup di `/api/admin/*`**, iaitu
tepat awalan yang Access lindungi. Kedua-duanya sampai ke pengendali yang sama, dan
setiap tulisan tetap diperiksa oleh Worker - jadi menyembunyikan butang tidak pernah
menjadi satu-satunya halangan.

**Senarai dihantar dalam bentuk padat.** Setiap rekod dahulunya mengulang nama medan
yang panjang (`Label`, `Jenis Aset`, `Pegawai Penempatan`, `Bahagian`, `Lokasi Terkini`)
536 kali, dan setiap jawapan JSON dicetak berindentasi. Sekarang nama lajur dinyatakan
sekali sahaja:

```json
{ "fields": ["Label", "Jenis Aset", "Pegawai Penempatan", "Bahagian", "Lokasi Terkini"],
  "rows": [["I/PKS/001", "Komputer", "...", "BAHAGIAN A", "..."]] }
```

Diukur oleh suite Worker: senarai **36% lebih kecil**, sejarah **49% lebih kecil**
(32,383 vs 50,715 bait; dan 79,036 vs 153,903 bait).

**Setiap bacaan membawa ETag.** Permintaan ulangan dijawab **304 tanpa badan**, dan
`Cache-Control` membenarkan cache kongsi memegang jawapan selama 15 saat
(`s-maxage=15, stale-while-revalidate=60`) sementara pelayar tetap mengesahkan setiap
kali (`max-age=0, must-revalidate`) - jadi senarai tidak pernah basi. Tulisan **tidak**
pernah dicache: jawapan 201/409 yang dicache ialah pembohongan.

| Endpoint | Guna |
| --- | --- |
| `GET /api/bootstrap` | **Semua yang halaman perlukan, dalam satu permintaan** - identiti, kesihatan, status, senarai semasa, kemajuan, sejarah dan tetapan Bahagian. |
| `GET /api/health` | Keadaan perkhidmatan dan saiz pangkalan data |
| `GET /api/status` | Ringkasan semasa |
| `GET /api/current` | Senarai semasa: aset dalam pemerhatian terakhir, iaitu senarai yang dimuat naik (ini yang dibaca pembaca) |
| `GET /api/me` | Peranan pemanggil: `role`, `mode`, `loginMethod`, `passwordConfigured`, `writeAllowed`, `adminLoginPath` |
| `GET /api/progress` | Kemajuan setiap titik masa, termasuk pecahan **setiap bahagian** |
| `GET /api/history` | Semua label setiap titik masa (tab Sejarah) |
| `GET /api/observations` | Senarai titik masa |
| `GET /api/observations/<id>` | Keahlian satu titik masa |
| `GET /api/timeline/<label>` | Sejarah satu aset |
| `GET /api/overrides` | Tetapan Bahagian manual yang disimpan |
| `GET /api/export.csv` | Sejarah penuh sebagai CSV (butang **Eksport sejarah**) |
| `GET /api/admin/login` | Dalam mod `enforce`: pintu masuk Access (mengubah hala ke log masuk, kemudian kembali ke halaman) |
| `POST /api/admin/login` | Dalam mod `password`: semak kata laluan; balasan ialah kuki `HttpOnly` bertandatangan. Salah: 401. `ADMIN_PASSWORD` belum diset: 403 |
| `GET`/`POST /api/admin/logout` | Log keluar: buang kuki sesi (dan, dalam mod `enforce`, kuki Access) |
| `POST /api/admin/observations` | Rekod satu pemerhatian (dihantar oleh aplikasi) |
| `POST /api/admin/overrides` | Simpan atau batalkan tetapan Bahagian |
| `POST /api/admin/figures` | Simpan angka daftar tulisan tangan (`totalAssets`, `inspected`, `outstanding`); `null` pada ketiga-tiganya membuangnya. Nilai bukan integer 0-10000000 ditolak 400 |
| `DELETE /api/admin/observations/<id>` | Padam satu titik masa (butang **Padam** dalam tab Sejarah) |
| `DELETE /api/admin/observations` | Padam **semua** titik masa (butang **Padam semua titik masa**; tetapan Bahagian manual kekal) |

Halaman membaca `/api/bootstrap` sekali semasa buka (dahulu enam permintaan dalam dua
gelombang) dan menyimpan muat naik melalui `POST /api/admin/observations`. Kerja
kiraan - label mana yang hilang, dan di bahagian mana - dilakukan oleh Worker daripada
rekod tersimpan, **bukan** oleh pelayar. Itu penting: dua tempat mengira perkara yang
sama ialah cara dua nombor mula berbeza. Selepas setiap tulisan, halaman membaca
semula dengan nonce (`?t=...`) supaya cache kongsi tidak menyajikan senarai pra-tulisan.

Muatan berulang **ditolak** dengan HTTP 409, supaya memuat semula halaman tidak
mencipta titik masa palsu.

Tanpa log masuk, permintaan tulis dijawab **401** (tiada token) atau **403** (token yang
bukan admin). Dalam mod `open`, jawapannya **403** dengan mesej yang menyatakan bahawa
log masuk admin belum disediakan - gagal secara tertutup, dengan sebab yang jelas.

> **Menetapkan semula:** untuk ujian atau demonstrasi yang boleh diulang, kosongkan
> jadual melalui D1:
>
> ```bash
> npx wrangler d1 execute aset-pks --remote \
>   --command "DELETE FROM observation_assets; DELETE FROM observations; DELETE FROM dept_snapshots; DELETE FROM bahagian_overrides;"
> ```
>
> **AMARAN:** arahan itu memusnahkan semua rekod. Jangan gunakannya pada data sebenar.
>
> **Nota keselamatan:** Worker ini **tiada log masuk**. Sesiapa yang mempunyai URL
> boleh membaca dan menulis rekod. Simpan URL itu dalam kalangan yang berkenaan, atau
> letakkan **Cloudflare Access** di hadapannya jika data itu sensitif.

Ciri **Ringkasan Bahagian** dalam aplikasi masih tersedia dan tidak memerlukan
apa-apa tambahan. Untuk sejarah, gunakan butang **Eksport sejarah (CSV)**: fail itu
dijana oleh Worker daripada rekod dalam D1, jadi ia sentiasa sepadan dengan apa yang
tersimpan - bukan dengan apa yang kebetulan ada pada skrin.

Pastikan `npm install` telah dijalankan (untuk wrangler) dan `npm run build` telah
menghasilkan `public/` sebelum mana-mana arahan `npm run cf:*`.

### Uji pada saiz data sebenar tanpa data sebenar

```bash
npm run scenario              # 473 + 63, 40 label kongsi
npm run scenario -- 473 63 0  # kes tiada pertindihan langsung
```

`tools/synthetic-data.mjs` menjana fail contoh yang meniru bentuk fail sebenar
(termasuk markup yang tidak lengkap), jadi saiz penuh boleh diuji tanpa
menggunakan data institusi.

Ujian UI juga boleh dijalankan pada saiz sebenar:

```bash
JKM_SYNTHETIC=1 node tools/verify-ui.mjs
JKM_SYNTHETIC=1 JKM_OVERLAP=0 node tools/verify-ui.mjs
```

### Gabung melalui baris perintah

```bash
node tools/merge-files.mjs -o hasil a.xls b.xls
node tools/merge-files.mjs --key labelAndType -o hasil a.xls b.xls
node tools/merge-files.mjs --formats xls,csv,json -o hasil a.xls b.xls
```

Keluar dengan kod `3` apabila konflik data dikesan, supaya skrip boleh bertindak balas.

### Uji dalam pelayar sebenar

```bash
node tools/verify-ui.mjs
```

Ini membina halaman ujian, menjalankannya dalam Chrome tanpa kepala (headless),
memandu saluran sebenar aplikasi (muat fail, gabung, papar, eksport), dan
memeriksa DOM yang terhasil. Ia memerlukan Chrome/Edge; tetapkan `CHROME_PATH`
jika ia berada di lokasi bukan standard.

### Menyediakan data ujian

`tests/run-tests.mjs` melangkau bahagian data sebenar jika tiada fail contoh.
Untuk mengaktifkannya, letakkan fail eksport di `fixture/`:

```text
fixture/Senarai_Aset_Belum_Periksa_JKM.xls
```

Atau tetapkan `JKM_FIXTURE` kepada mana-mana fail eksport. Ujian UI juga menerima
`JKM_FILE_A` dan `JKM_FILE_B` untuk menguji gabungan dua fail yang berbeza.

---

## 7. Nota teknikal tentang fail sumber

Fail eksport JKM mempunyai beberapa keanehan yang aplikasi ini dibina khas untuk
mengendalikannya. Setiap satu mempunyai ujian regresi yang sepadan:

1. **Bukan Excel binari.** Fail bermula dengan blok `<script>` dan kemudian jadual
   HTML. Pengesanan format menyiasat kandungan, bukan sambungan fail.
2. **Markup tidak lengkap.** Sesetengah `<tr>` tidak ditutup, dan tag penutup
   tambahan muncul. Baris pertama data berkongsi `<tr>` dengan baris tajuk.
   Penghurai mengumpul sel ke dalam satu aliran dengan penanda pemisah baris, dan
   mencari awalan tajuk yang sepadan dengan lajur yang diketahui, kemudian
   mengambil **satu baris sumber penuh** sebagai tajuk - jadi 12 sel dalam bakul
   pertama (6 tajuk + 6 data) dilaporkan sebagai 6 lajur, dan baris data itu tidak
   hilang.
3. **Lajur "Status Aset" yang tidak dijejaki.** Fail sumber mempunyai **6 lajur**,
   tetapi aplikasi hanya menjejaki **5**. Penghurai membaca lajur ke-6 itu lalu
   membuangnya. Ini penting: jika lajur itu tidak dibaca-past dengan betul, setiap
   medan akan bergeser satu kedudukan dan baris tajuk muncul sebagai rekod palsu.
4. **Lajur tambahan pada eksport.** Eksport aplikasi menambah "Bilangan Salinan"
   sahaja (provenans tidak dieksport). Sel tajuk itu ditandakan dengan aksara lebar
   sifar supaya ia kekal pada tajuk tetapi tidak pernah masuk ke dalam medan aset.

### Amaran penyelenggaraan

Fail dalam `src/` mestilah **ASCII sahaja**. Fail ini ditulis semula oleh skrip
PowerShell semasa pembangunan, dan aksara bukan ASCII tidak bertahan dalam
kitaran itu dengan boleh dipercayai. Gunakan `-` dan bukan sengkang panjang, dan
`\uXXXX` untuk apa-apa nilai bukan ASCII yang benar-benar diperlukan. `npm run
build` akan gagal dengan mesej yang jelas jika aksara bukan ASCII dikesan.

---

## 8. Had yang diketahui

- **Buku kerja Excel binari tidak disokong.** Eksport semula sebagai HTML atau CSV.
- **ABR dan HM mengandungi aset yang berbeza sepenuhnya.** Tiada label dikongsi
  (0 pertindihan), jadi gabungannya ialah 473 + 63 = 536 rekod. Jika anda
  menjangka HM ialah subset ABR, maka fail HM yang dieksport memuatkan set aset
  yang lain.
- **10 rekod ABR mempunyai medan `Bahagian` yang kosong dalam fail sumber** -
  semuanya berlabel awalan `R` (cth. `KPT/PKS/R/90/11`). Ini adalah kekosongan
  data sebenar, bukan ralat penghuraian; aplikasi memaparkannya sebagai sel kosong,
  menandakannya dalam ringkasan, dan turut memasukkannya ke dalam eksport. Medan
  Label dan Jenis Aset lengkap untuk kesemua 536 rekod.
- **Provenans tidak disimpan pada rekod.** Rekod gabungan mengandungi lima medan aset sahaja (tambah kiraan salinan). Lajur `Sumber Fail` telah dibuang daripada jadual dan eksport. Maklumat fail masih dikesan secara dalaman untuk tab **Konflik Data** dan **Butiran Fail**, jadi pertindihan yang bercanggah tetap dilaporkan.
- **`Status Aset` diabaikan sepenuhnya.** Fail sumber masih mempunyai lajur itu
  (lajur ke-6). Jika anda memerlukannya kemudian, tambah semula `'Status Aset'` ke
  `FIELDS` dalam `src/parser.mjs`; tiada logik lain perlu diubah.
- **Label diandaikan sebagai identiti merentas laporan.** Dua laporan yang
  berkongsi label dianggap merujuk aset yang SAMA. Jika tidak, gunakan
  **Label aset + Jenis Aset** sebagai kunci padanan, atau muatkan fail secara
  berasingan.
- **Pembaca tidak boleh menulis.** Tiada muat naik, tiada padam titik masa, tiada
tetapan Bahagian - dan Worker menolaknya walaupun panggilan itu datang terus ke API,
bukan melalui halaman.
- **Senarai ini awam, dan itu satu keputusan.** Sesiapa yang mempunyai pautan boleh
membacanya tanpa log masuk. Yang memerlukan log masuk hanya tulisan. Jika senarai itu
tidak boleh dilihat awam, jangan deploy di URL awam - letakkan Access pada hosname
penuh dan sedar bahawa pembaca kemudiannya perlu akaun.
- **Dalam mod `open` (lalai), tiada sesiapa boleh menulis** - termasuk admin, kerana
  tiada log masuk wujud lagi untuk membuktikan siapa admin. Halaman menyatakannya
  ("Log masuk admin belum disediakan"), dan begitulah juga `npm run cf:smoke`.
- **Mod `trusted` tiada log masuk langsung.** Sesiapa yang boleh membuka URL ialah
admin. Ia untuk salinan peribadi; halaman memberi amaran kuat apabila ia aktif.
- **Fail HTML luar talian ialah alat admin.** Ia tiada D1, jadi tiada sejarah dan tiada
tetapan Bahagian di sana.
- **Halaman yang dibuka dengan dua klik (`file://`) tiada sejarah dan tiada
  penetapan Bahagian.** Kedua-duanya memerlukan D1. Gabung, tapis dan eksport
  berfungsi seperti biasa, dan panel **Sambungan D1** menyatakan had ini dengan
  jelas. Ini ialah kos yang diterima apabila simpanan pelayar dibuang: satu tempat
  simpanan, bukan dua.
- **Tiada pemulihan automatik fail.** Membuka semula halaman bermula dengan senarai
  kosong; muat naik semula fail anda. Senarai yang dimuatkan sebelum ini tidak
  "hilang" daripada D1 - ia masih ada sebagai titik masa dalam tab Sejarah.
- Semua pemprosesan berlaku dalam memori pelayar. Paparan dihalaman 250 baris
  pada satu masa.
