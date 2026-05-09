const express = require("express");
const axios = require("axios");
const puppeteer = require("puppeteer");

const app = express();
app.use(express.json());

const KOLAYGELSIN_KULLANICI = "seyhanbs";
const KOLAYGELSIN_SIFRE     = "153759";
const ULTRAMSG_URL          = "https://api.ultramsg.com/instance174194";
const ULTRAMSG_TOKEN        = "7wwhgbrsha8qtzqd";
const GRUP_ID               = "120363426448176462@g.us";

// Tarayıcıyı başlangıçta aç ve oturumu açık tut
let browserInstance = null;
let pageInstance = null;

async function tarayiciBaslat() {
  try {
    browserInstance = await puppeteer.launch({
      headless: "new",
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-first-run",
        "--no-zygote",
        "--single-process",
      ],
    });

    pageInstance = await browserInstance.newPage();
    await pageInstance.setDefaultTimeout(30000);

    // Giriş yap
    console.log("🔐 Kolay Gelsin'e giriş yapılıyor...");
    await pageInstance.goto("https://kurumsal.kolaygelsin.com/login", {
      waitUntil: "networkidle2", timeout: 30000,
    });

    await bekle(2000);

    // Tüm inputları bul
    const inputlar = await pageInstance.$$('input');
    console.log(`📝 ${inputlar.length} input bulundu`);

    if (inputlar.length >= 2) {
      await inputlar[0].click({ clickCount: 3 });
      await inputlar[0].type(KOLAYGELSIN_KULLANICI);
      await inputlar[1].click({ clickCount: 3 });
      await inputlar[1].type(KOLAYGELSIN_SIFRE);
      await pageInstance.keyboard.press("Enter");
      await pageInstance.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 });
    }

    const url = pageInstance.url();
    console.log(`✅ Giriş sonrası URL: ${url}`);
    return true;
  } catch (hata) {
    console.error("❌ Tarayıcı başlatma hatası:", hata.message);
    return false;
  }
}

async function gonderiGetir(gonderiNo) {
  if (!browserInstance || !pageInstance) {
    await tarayiciBaslat();
  }

  try {
    // Gönderi takip sayfasına git
    await pageInstance.goto(
      "https://kurumsal.kolaygelsin.com/pages/shipment-search",
      { waitUntil: "networkidle2", timeout: 20000 }
    );
    await bekle(2000);

    // Sayfa URL kontrol — giriş yapılmış mı?
    const url = pageInstance.url();
    if (url.includes("login")) {
      console.log("🔄 Oturum sona ermiş, tekrar giriş yapılıyor...");
      browserInstance = null;
      pageInstance = null;
      await tarayiciBaslat();
      await pageInstance.goto(
        "https://kurumsal.kolaygelsin.com/pages/shipment-search",
        { waitUntil: "networkidle2", timeout: 20000 }
      );
      await bekle(2000);
    }

    // Gönderi numarasını gir
    const inputlar = await pageInstance.$$('input[type="text"]');
    if (inputlar.length > 0) {
      await inputlar[0].click({ clickCount: 3 });
      await inputlar[0].type(gonderiNo);
    }

    // Filtrele butonuna tıkla
    await pageInstance.evaluate(() => {
      const butonlar = Array.from(document.querySelectorAll("button"));
      const btn = butonlar.find(b =>
        b.innerText?.toLowerCase().includes("filtrele") ||
        b.innerText?.toLowerCase().includes("ara")
      );
      if (btn) btn.click();
    });

    await bekle(3000);

    // Satıra tıkla
    await pageInstance.evaluate(() => {
      const satirlar = document.querySelectorAll("tr.clickable, tbody tr, table tr");
      if (satirlar.length > 1) satirlar[1].click();
    });

    await bekle(1000);

    // Ayrıntılar butonuna tıkla
    await pageInstance.evaluate(() => {
      const butonlar = Array.from(document.querySelectorAll("button, a"));
      const btn = butonlar.find(b =>
        b.innerText?.toLowerCase().includes("ayrıntılar") ||
        b.innerText?.toLowerCase().includes("detay")
      );
      if (btn) btn.click();
    });

    await bekle(2000);

    // Bilgileri çek
    const bilgiler = await pageInstance.evaluate(() => {
      const tumMetin = document.body.innerText;

      // Ad Soyad
      let adSoyad = "";
      const satirlar = tumMetin.split("\n").map(s => s.trim()).filter(s => s);
      for (let i = 0; i < satirlar.length; i++) {
        if (
          satirlar[i].toLowerCase().includes("alıcı adı soyadı") ||
          satirlar[i].toLowerCase().includes("alıcı adı") ||
          satirlar[i].toLowerCase().includes("ad soyad")
        ) {
          const sonraki = satirlar[i + 1] || "";
          if (sonraki && sonraki.length > 2 && !sonraki.includes(":")) {
            adSoyad = sonraki;
            break;
          }
        }
      }

      // Telefon — Gsm formatı
      let telefon = "";
      const gsmMatch = tumMetin.match(/Gsm[:\s]+(\d{10,11})/i);
      if (gsmMatch) {
        const no = gsmMatch[1].replace(/^0/, "");
        telefon = "0" + no;
      } else {
        const telMatch = tumMetin.match(/0?5\d{9}/);
        if (telMatch) telefon = telMatch[0].startsWith("0") ? telMatch[0] : "0" + telMatch[0];
      }

      return { adSoyad, telefon, tumMetin: tumMetin.substring(0, 500) };
    });

    console.log("📋 Çekilen bilgiler:", bilgiler.adSoyad, bilgiler.telefon);
    console.log("📄 Sayfa özeti:", bilgiler.tumMetin);

    return { adSoyad: bilgiler.adSoyad, telefon: bilgiler.telefon };
  } catch (hata) {
    console.error(`❌ Gönderi hatası:`, hata.message);
    browserInstance = null;
    pageInstance = null;
    throw hata;
  }
}

// KUYRUK
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
        await mesajaReplyAt(mesajId,
          `📦 *Gönderi No:* ${gonderiNo}\n` +
          `👤 *Ad Soyad:* ${bilgi.adSoyad || "Bulunamadı"}\n` +
          `📞 *Telefon:* ${bilgi.telefon || "Bulunamadı"}`
        );
      } else {
        await mesajaReplyAt(mesajId, `❌ *${gonderiNo}* için bilgi bulunamadı.`);
      }
    } catch (hata) {
      await mesajaReplyAt(mesajId, `⚠️ Hata: ${hata.message}`);
    }
    await bekle(1000);
  }
  islemDevamEdiyor = false;
}

async function mesajaReplyAt(mesajId, mesaj) {
  await axios.post(`${ULTRAMSG_URL}/messages/chat`, {
    token: ULTRAMSG_TOKEN,
    to: GRUP_ID,
    body: mesaj,
    quotedMsgId: mesajId,
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
      await mesajaReplyAt(mesajId, `⏳ Kuyruğa alındı. Sıra: *${kuyruk.length}*`);
    }
    kuyrukIsle();
  } catch (hata) {
    console.error("Webhook hatası:", hata.message);
  }
});

function bekle(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Başlangıçta giriş yap
tarayiciBaslat();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Kurye botu çalışıyor! Port: ${PORT}`));
