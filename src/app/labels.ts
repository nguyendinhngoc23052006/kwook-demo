/**
 * What each detector means, in the seller's terms.
 *
 * Shared because two screens need the same words for the same finding. Cảnh
 * báo uses them as the fallback when a model wrote no explanation; Bảng giá
 * uses the title to say WHY a spread is alarming, right where the spread is.
 * Two copies would drift, and a detector renamed in one place would quietly
 * start showing its raw type name in the other.
 */
export const LABELS: Record<string, { title: string; why: string; offWhy?: string }> = {
  self_cannibalization: {
    title: "Tự cạnh tranh giá",
    why: "Cùng một người bán đăng một sản phẩm ở nhiều mức giá — người mua sẽ chọn mức thấp nhất.",
  },
  dead_listing: {
    title: "Listing đứng im",
    why: "Không bán thêm được sản phẩm nào trong 24 giờ, trong khi listing khác cùng sản phẩm vẫn bán được — có thể đã hết hàng hoặc bị ẩn.",
  },
  dispersion: {
    title: "Giá phân tán giữa các kênh",
    why: "Mỗi kênh bán một giá khác nhau — khách so giá sẽ mua ở kênh rẻ nhất, và đại lý bán đúng giá mất khách.",
  },
  floor_breach: {
    title: "Phá giá sàn",
    why: "Giá bán thấp hơn mức sàn đã đặt cho sản phẩm này.",
    // Shown only when the rule is off, so the screen never implies this was
    // checked and passed. Kwook publishes no official list price anywhere
    // reachable, and the wholesale prices found instead disagree by 50%.
    offWhy: "Chưa có giá niêm yết chính thức để so sánh — cần Kwook cung cấp giá sàn.",
  },
  fake_anchor: {
    title: "Giá gạch ảo",
    why: "Giá gạch cao bất thường so với giá bán — con số khuyến mãi không phản ánh giá thật.",
  },
  attribution_loss: {
    title: "Mất thương hiệu",
    why: "Listing không ghi tên thương hiệu, nên doanh số không quy về Kwook.",
  },
  new_seller: {
    title: "Người bán mới",
    why: "Một listing chưa từng thấy ở lượt quét trước.",
  },
};
