const express = require("express");
const axios = require("axios");
const puppeteer = require("puppeteer-core");

const app = express();
app.use(express.json());

const KOLAYGELSIN_KULLANICI = "seyhanbs";
const KOLAYGELSIN_SIFRE     = "153759";
const ULTRAMSG_URL          = "https://api.ultramsg.com/instance174194";
const ULTRAMSG_TOKEN        = "7wwhgbrsha8qtzqd";
const GRUP_ID               = "120363426448176462@g.us";
const BROWSERLESS_KEY       = "2UUU9ks8ljiUIFPef1975f4001009046682ef4aaa174d1f20";

async function gonderiGetir(gonderiNo) {
  let browser = null;
  try {
    browser = await puppeteer.connect({
      browserWSEndpoint: `wss://production-sfo.browserless.io?token=${BROWSERLESS_KEY}&timeout=60000`,
    });

    const page = await browser.newPage();
    await page.setDefaultTimeout(20000);

    // Giriş yap
    await page.goto("https://kurumsal.kolaygelsin.com/login", { waitUntil: "domcontentloaded", timeout: 20000 });
    await bekle(1500);

    const inputlar = await page.$$("input");
    if (inputlar.length >= 2) {
      await inputlar[0].type(KOLAYGELSIN_KULLANICI, { delay: 30 });
      await inputlar[1].type(KOLAYGELSIN_SIFRE, { delay: 30 });
      await page.keyboard.press("Enter");
      await bekle(2500);
    }

    // Gönderi takip sayfasına git
    await page.goto("https://kurumsal.kolaygelsin.com/pages/shipments/shipmentTrack", {
      waitUntil: "domcontentloaded", timeout: 20000,
    });
    await bekle(1500);

    // Gönderi numarasını gir
    const inputlar2 = await page.$$('input[type="text"]');
    if (inputlar2.length > 0) {
      await inputlar2[0].click({ clickCount: 3 });
      await inputlar2[0].type(gonderiNo, { delay: 30 });
    }

    // Filtrele
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll("button")).find(b =>
        b.innerText?.toLowerCase().includes("filtrele") || b.innerText?.toLowerCase().includes("ara")
      );
      if (b) b.click();
    });
    await bekle(2500);

    // Satıra tıkla
    await page.evaluate(() => {
      const s = document.querySelectorAll("tbody tr");
      if (s.length > 0) s[0].click();
    });
    await bekle(800);

    // Ayrıntılar
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll("button, a")).find(b =>
        b.innerText?.toLowerCase().includes("ayrıntılar") || b.innerText?.toLowerCase().includes("detay")
      );
      if (b) b.click();
    });
    await bekle(1500);

    // Bilgileri çek
    const bilgiler = await page.evaluate(() => {
      const metin = document.body.innerText;
      const satirlar = metin.split("\n").map(s => s.trim()).filter(s => s);

      let adSoyad = "";
      for (let i = 0; i < satirlar.length; i++) {
        if (satirlar[i].toLowerCase().includes("alıcı adı soyadı") ||
            satirlar[i].toLowerCase().includes("alıcı adı")) {
          adSoyad = satirlar[i + 1] || "";
          break;
        }
      }

      let telefon = "";
      const gsmMatch = metin.match(/Gsm[:\s]+(5\d{9})/i);
      if (gsmMatch) {
        telefon = "0" + gsmMatch[1];
      } else {
        const tumTelefon = metin.match(/0?5\d{9}/g) || [];
        const gsm = tumTelefon.find(t => t.replace(/^0/, "").startsWith("5"));
        if (gsm) telefon = gsm.startsWith("0") ? gsm : "0" + gsm;
      }

      return { adSoyad, telefon };
    });

    await browser.close();
    return bilgiler;
  } catch (e) {
    if (browser) await browser.close().catch(() => {});
    throw e;
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
      const kalanMesaj = kuyruk.length > 0 ? ` (Sirada ${kuyruk.length} sorgu daha var)` : "";
      await mesajaReplyAt(mesajId, `Sorgulanıyor...${kalanMesaj}`);
      const bilgi = await gonderiGetir(gonderiNo);
      if (bilgi.adSoyad || bilgi.telefon) {
        await mesajaReplyAt(mesajId,
          `Gonderi No: ${gonderiNo}\n` +
          `Ad Soyad: ${bilgi.adSoyad || "Bulunamadi"}\n` +
          `Telefon: ${bilgi.telefon || "Bulunamadi"}`
        );
      } else {
        await mesajaReplyAt(mesajId, `${gonderiNo} icin bilgi bulunamadi.`);
      }
    } catch (e) {
      console.error("Hata:", e.message);
      await mesajaReplyAt(mesajId, `Hata olustu, tekrar deneyin.`);
    }
    await bekle(500);
  }
  islemDevamEdiyor = false;
}

async function mesajaReplyAt(mesajId, mesaj) {
  await axios.post(`${ULTRAMSG_URL}/messages/chat`, {
    token: ULTRAMSG_TOKEN, to: GRUP_ID, body: mesaj, quotedMsgId: mesajId,
  });
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
    if (eklendi && kuyruk.length > 1) {
      await mesajaReplyAt(mesajId, `Siraya alindi. Sira: ${kuyruk.length}`);
    }
    kuyrukIsle();
  } catch (e) { console.error("Webhook hatasi:", e.message); }
});

function bekle(ms) { return new Promise(r => setTimeout(r, ms)); }

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Bot calisiyor! Port: ${PORT}`));
