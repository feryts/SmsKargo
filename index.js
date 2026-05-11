const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

const KOLAYGELSIN_KULLANICI = "seyhanbs";
const KOLAYGELSIN_SIFRE     = "153759";
const API_BASE              = "https://api.kolaygelsin.com/api/request";

let token = null;
let tokenZamani = null;

// Token al
async function tokenAl() {
  try {
    const res = await axios.post(`${API_BASE}/Login`, {
      Username: KOLAYGELSIN_KULLANICI,
      Password: KOLAYGELSIN_SIFRE,
      Channel: "Portal"
    }, {
      headers: { "Content-Type": "application/json" }
    });

    const t = res.data?.Payload?.Token || res.data?.token || res.data?.Token;
    if (t) {
      token = t;
      tokenZamani = Date.now();
      console.log("Token alindi!");
      return true;
    }
    console.log("Token yaniti:", JSON.stringify(res.data).substring(0, 200));
    return false;
  } catch (e) {
    console.error("Token hatasi:", e.message);
    return false;
  }
}

// Token geçerli mi kontrol et (23 saatte bir yenile)
async function tokenKontrol() {
  if (!token || !tokenZamani || (Date.now() - tokenZamani) > 23 * 60 * 60 * 1000) {
    await tokenAl();
  }
}

async function gonderiGetir(gonderiNo) {
  await tokenKontrol();
  if (!token) throw new Error("Token alinamadi");

  const headers = {
    "Content-Type": "application/json",
    "Authorization": `bearer ${token}`,
    "access-control-allow-methods": "GET, POST, PUT, DELETE",
    "access-control-allow-origin": "*",
  };

  // Adım 1: GetShipments — ad soyad al
  const shipmentsRes = await axios.post(`${API_BASE}/GetShipments`, {
    ShipmentId: gonderiNo,
    PageSize: 10,
    PageNumber: 1
  }, { headers });

  console.log("GetShipments:", JSON.stringify(shipmentsRes.data?.Payload?.ResultList?.[0]).substring(0, 200));

  const shipment = shipmentsRes.data?.Payload?.ResultList?.[0];
  if (!shipment) throw new Error("Gonderi bulunamadi");

  const adSoyad = shipment.RecipientName || "";
  const shipmentId = shipment.ShipmentId;

  // Adım 2: GetShipmentById — telefon al
  const detayRes = await axios.post(`${API_BASE}/GetShipmentById`, {
    ShipmentId: shipmentId
  }, { headers });

  console.log("GetShipmentById:", JSON.stringify(detayRes.data?.Payload).substring(0, 300));

  const detay = detayRes.data?.Payload;
  
  // Telefon numarasını bul
  let telefon = "";
  const detayStr = JSON.stringify(detay);
  const gsmMatch = detayStr.match(/"(5\d{9})"/);
  if (gsmMatch) {
    telefon = "0" + gsmMatch[1];
  } else {
    const telMatch = detayStr.match(/"0?(5\d{9})"/);
    if (telMatch) telefon = "0" + telMatch[1].replace(/^0/, "");
  }

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

// Başlangıçta token al
tokenAl();

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Sunucu calisiyor! Port: ${PORT}`));
