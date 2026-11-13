// 预设封面在字节系 CDN 上的原始文件名（与 /card-assets/covers/NN.png 一一对应）。
// 手机端不加载自签名站点的图片，所以发送卡片时使用 CDN 地址。
const BASE = 'https://p3-aio.ecombdimg.com/obj/ecom-shop-material/';
const FILES = [
  "jpeg_m_4b0c5160496554178d8692bdba0317b8_sx_29901_www200-200",
  "jpeg_m_f1bd41431af8852dc2834bb0435234a7_sx_7979_www150-150",
  "jpeg_m_4ec238cabc447e2fc0e0509d38dbb172_sx_9850_www150-150",
  "jpeg_m_990097a52a52cb377608256ab60848a4_sx_6928_www150-150",
  "jpeg_m_7ca5083e8a61314c1733636013b13abe_sx_6866_www150-150",
  "jpeg_m_b3bac5b90bccc9fc88697c11a2fab191_sx_8040_www150-150",
  "jpeg_m_0ec430e982a67372ec9043fd5a7e9629_sx_8423_www150-150",
  "jpeg_m_e4e99010c36fbfc0afd05b0cb8e2ae15_sx_8295_www150-150",
  "jpeg_m_d9bf26b629f421feacc7df0c5f450067_sx_7195_www150-150",
  "jpeg_m_e953eb5786224f3c88e02883b9c32861_sx_8576_www150-150",
  "jpeg_m_f917b45eb50051c89460c2d066cdfcdc_sx_8719_www150-150",
  "jpeg_m_9fbe7a74bf7cc6aaf2855afeaa2845df_sx_6380_www150-150",
  "png_m_bc5bea3e28a542ab579c1e8f5eab4a8c_sx_27814_www150-150",
  "png_m_570125c3488e894321230f95efb86f9a_sx_28116_www150-150",
  "png_m_4aea623edd29d360a563f7277acc7736_sx_23674_www150-150",
  "png_m_4ee25b6a65f4b090cb65e13bb90c0a53_sx_26771_www150-150",
  "png_m_ef0bb8899caebb344816d4ab2873ea82_sx_9356_www150-150",
  "png_m_4c5c42c959a455eb894059b0cf3a79ed_sx_22331_www150-150",
  "png_m_762642126400e0bb966344b180f058fb_sx_16667_www150-150",
  "png_m_30d271fbb86e5d0a925ce2c9b8658e54_sx_15908_www150-150",
  "png_m_9cd50211ae68f0d1820000fae28b8c7e_sx_6356_www150-150",
  "png_m_26921c0c1004c66683734fd3511e4ff7_sx_9442_www150-150",
  "png_m_42fbb28cd4ed2a136383a743ecc520df_sx_17742_www150-150",
  "png_m_d70f934b5fdac8b55df280a40f7a70b1_sx_19557_www150-150",
  "png_m_a42524362fd0eec8bcf63240485e3156_sx_20330_www150-150",
  "png_m_5202115b914dd0d1109634e7178b3843_sx_25711_www150-150",
  "png_m_044a1f822718c928f4bc70f8c6729381_sx_27031_www150-150",
  "png_m_3c877b165bd3484828d73d8736a66735_sx_18210_www150-150"
];

export function coverCdnUrl(cover) {
  const match = /^\/card-assets\/covers\/(\d{2})\.png$/.exec(String(cover || ''));
  const file = match ? FILES[Number(match[1]) - 1] : '';
  return file ? BASE + file : '';
}
