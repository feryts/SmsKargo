const puppeteer = require("puppeteer");
const axios = require("axios");
const puppeteer = require("puppeteer-core");

const app = express();
app.use(express.json());

const KOLAYGELSIN_KULLANICI = "seyhanbs";
const KOLAYGELSIN_SIFRE     = "153759";
const ULTRAMSG_URL          = "https://api.ultramsg.com/instance174194";
const ULTRAMSG_TOKEN        = "7wwhgbrsha8qtzqd";
const GRUP_ID               = "120363426448176462@g.us";

let browser = null;
let page = null;

async function tarayiciBaslat() {
  try {
    browser = await puppeteer.launch({
      headless: "new",
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/google-chrome-stable",
      args: ["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage","--disable-gpu","--single-process","--no-zygote"],
    });
    page = await browser.newPage();
    await page.setDefaultTimeout(30000);
    console.log("🔐 Giriş yapılıyor...");
    await page.goto("https://kurumsal.kolaygelsin.com/login", { waitUntil: "networkidle2", timeout: 30000 });
    await bekle(2000);
    const inputlar = await page.$$("input");
    if (inputlar.length >= 2) {
      await inputlar[0].type(KOLAYGELSIN_KULLANICI);
      await inputlar[1].type(KOLAYGELSIN_SIFRE);
      await page.keyboard.press("Enter");
      await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => {});
    }
    console.log("✅ Giriş tamamlandı:", page.url());
    return true;
  } catch (e) {
    console.error("❌ Hata:", e.message);
    browser = null; page = null;
    return false;
  }
}

async function gonderiGetir(gonderiNo) {
  if (!browser || !page) {
    const ok = await tarayiciBaslat();
    if (!ok) throw new Error("Tarayıcı başlatılamadı");
  }
  try {
    if (page.url().includes("login")) { browser = null; page = null; await tarayiciBaslat(); }
    await page.goto("https://kurumsal.kolaygelsin.com/pages/shipments/shipmentTrack", { waitUntil: "networkidle2", timeout: 20000 });
    await bekle(2000);
    const inputlar = await page.$$('input[type="text"]');
    if (inputlar.length > 0) { await inputlar[0].click({ clickCount: 3 }); await inputlar[0].type(gonderiNo); }
    await page.evaluate(() => { const b = Array.from(document.querySelectorAll("button")).find(b => b.innerText?.toLowerCase().includes("filtrele") || b.innerText?.toLowerCase().includes("ara")); if (b) b.click(); });
    await bekle(3000);
    await page.evaluate(() => { const s = document.querySelectorAll("tbody tr"); if (s.length > 0) s[0].click(); });
    await bekle(1000);
    await page.evaluate(() => { const b = Array.from(document.querySelectorAll("button, a")).find(b => b.innerText?.toLowerCase().includes("ayrıntılar") || b.innerText?.toLowerCase().includes("detay")); if (b) b.click(); });
    await bekle(2000);
    const bilgiler = await page.evaluate(() => {
      const metin = document.body.innerText;
      const satirlar = metin.split("\n").map(s => s.trim()).filter(s => s);
      let adSoyad = "";
      for (let i = 0; i < satirlar.length; i++) {
        if (satirlar[i].toLowerCase().includes("alıcı adı soyadı") || satirlar[i].toLowerCase().includes("alıcı adı")) { adSoyad = satirlar[i + 1] || ""; break; }
      }
      let telefon = "";
      const gsmMatch = metin.match(/Gsm[:\s]+(\d{10,11})/i);
      if (gsmMatch) { telefon = "0" + gsmMatch[1].replace(/^0/, ""); }
      else { const t = metin.match(/0?5\d{9}/); if (t) telefon = t[0].startsWith("0") ? t[0] : "0" + t[0]; }
      return { adSoyad, telefon };
    });
    console.log("✅ Bilgiler:", bilgiler);
    return bilgiler;
  } catch (e) {
    console.error("❌ Hata:", e.message);
    browser = null; page = null; throw e;
  }
}

const kuyruk = [];
let islemDevamEdiyor = false;

function kuyrugaEkle(gonderiNo, mesajId) {
  if (kuyruk.find(k => k.gonderiNo === gonderiNo)) return false;
  kuyruk.push({ gonderiNo, mesajId });
  return true;
}

async function kuyrukIsle() {
  if (islemDevamEdiyor || kuyruk.length === 0) return;
  islemDevamEdiyor = true;
  while (kuyruk.length > 0) {
    const { gonderiNo, mesajId } = kuyruk.shift();
    try {
      const kalanMesaj = kuyruk.length > 0 ? `_(Sırada ${kuyruk.length} sorgu daha var)_` : "";
      await mesajaReplyAt(mesajId, `🔍 Sorgulanıyor... ${kalanMesaj}`);
      const bilgi = await gonderiGetir(gonderiNo);
      if (bilgi.adSoyad || bilgi.telefon) {
        await mesajaReplyAt(mesajId, `📦 *Gönderi No:* ${gonderiNo}\n👤 *Ad Soyad:* ${bilgi.adSoyad || "Bulunamadı"}\n📞 *Telefon:* ${bilgi.telefon || "Bulunamadı"}`);
      } else { await mesajaReplyAt(mesajId, `❌ *${gonderiNo}* için bilgi bulunamadı.`); }
    } catch (e) { await mesajaReplyAt(mesajId, `⚠️ Hata: ${e.message}`); }
    await bekle(1000);
  }
  islemDevamEdiyor = false;
}

async function mesajaReplyAt(mesajId, mesaj) {
  await axios.post(`${ULTRAMSG_URL}/messages/chat`, { token: ULTRAMSG_TOKEN, to: GRUP_ID, body: mesaj, quotedMsgId: mesajId });
}

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    const body = req.body;
    if (body.event_type !== "message_received") return;
    const mesaj = body.data?.body?.trim();
    if (!mesaj) return;
    const mesajId = body.data?.id;
    const grupId = body.data?.from;
    if (!grupId?.includes("@g.us")) return;
    const gonderiNo = mesaj.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    if (gonderiNo.length < 6 || gonderiNo.length > 25) return;
    const eklendi = kuyrugaEkle(gonderiNo, mesajId);
    if (eklendi && kuyruk.length > 1) { await mesajaReplyAt(mesajId, `⏳ Kuyruğa alındı. Sıra: *${kuyruk.length}*`); }
    kuyrukIsle();
  } catch (e) { console.error("Webhook hatası:", e.message); }
});

function bekle(ms) { return new Promise(r => setTimeout(r, ms)); }

tarayiciBaslat();

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Bot çalışıyor! Port: ${PORT}`));
