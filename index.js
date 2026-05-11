const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

const KOLAYGELSIN_KULLANICI = "seyhanbs";
const KOLAYGELSIN_SIFRE     = "153759";
const BROWSERLESS_KEY       = "2UUU9ks8ljiUIFPef1975f4001009046682ef4aaa174d1f20";
const BROWSERLESS_URL       = `https://production-sfo.browserless.io/scrape?token=${BROWSERLESS_KEY}`;

async function gonderiGetir(gonderiNo) {
  const sorguScript = {
    url: "https://kurumsal.kolaygelsin.com/login",
    elements: [{ selector: "body" }],
    gotoOptions: { waitUntil: "networkidle2", timeout: 30000 },
    scripts: [{
      code: `async () => {
        const inputs = document.querySelectorAll('input');
        if (inputs[0]) { inputs[0].value = '${KOLAYGELSIN_KULLANICI}'; inputs[0].dispatchEvent(new Event('input', { bubbles: true })); }
        if (inputs[1]) { inputs[1].value = '${KOLAYGELSIN_SIFRE}'; inputs[1].dispatchEvent(new Event('input', { bubbles: true })); }
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.type === 'submit' || b.innerText?.toLowerCase().includes('giri'));
        if (btn) btn.click();
        await new Promise(r => setTimeout(r, 4000));
        location.href = 'https://kurumsal.kolaygelsin.com/pages/shipments/shipmentTrack';
        await new Promise(r => setTimeout(r, 3000));
        const inp = document.querySelector('input[type="text"]');
        if (inp) { inp.value = '${gonderiNo}'; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })); }
        await new Promise(r => setTimeout(r, 500));
        const filtrele = Array.from(document.querySelectorAll('button')).find(b => b.innerText?.toLowerCase().includes('filtrele'));
        if (filtrele) filtrele.click();
        await new Promise(r => setTimeout(r, 3000));
        const row = document.querySelector('tbody tr');
        if (row) row.click();
        await new Promise(r => setTimeout(r, 1000));
        const detay = Array.from(document.querySelectorAll('button, a')).find(b => b.innerText?.toLowerCase().includes('ayrıntılar'));
        if (detay) detay.click();
        await new Promise(r => setTimeout(r, 2000));
        return document.body.innerText;
      }`
    }]
  };

  const res = await axios.post(BROWSERLESS_URL, sorguScript, {
    headers: { "Content-Type": "application/json" },
    timeout: 60000,
  });

  const metin = res.data?.scripts?.[0]?.result || "";
  console.log("Sayfa:", metin.substring(0, 300));

  const satirlar = metin.split("\n").map(s => s.trim()).filter(s => s);
  let adSoyad = "";
  for (let i = 0; i < satirlar.length; i++) {
    if (satirlar[i].toLowerCase().includes("alıcı adı soyadı") || satirlar[i].toLowerCase().includes("alıcı adı")) {
      adSoyad = satirlar[i + 1] || ""; break;
    }
  }
  let telefon = "";
  const gsmMatch = metin.match(/Gsm[:\s]+(5\d{9})/i);
  if (gsmMatch) { telefon = "0" + gsmMatch[1]; }
  else { const t = (metin.match(/0?5\d{9}/g) || []).find(t => t.replace(/^0/,"").startsWith("5")); if (t) telefon = t.startsWith("0") ? t : "0"+t; }

  return { adSoyad, telefon };
}

app.post("/sorgula", async (req, res) => {
  const { gonderiNo } = req.body;
  if (!gonderiNo) return res.json({ hata: "Gonderi no eksik" });
  try {
    const bilgi = await gonderiGetir(gonderiNo.toUpperCase());
    if (!bilgi.adSoyad && !bilgi.telefon) return res.json({ hata: "Bilgi bulunamadi" });
    res.json(bilgi);
  } catch (e) {
    console.error("Hata:", e.message);
    res.json({ hata: "Sorgu basarisiz: " + e.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Sunucu calisiyor! Port: ${PORT}`));
