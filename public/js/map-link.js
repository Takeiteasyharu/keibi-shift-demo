export function googleMapsSearchUrl(address) {
  const value = String(address || "").trim();
  return value ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(value)}` : "";
}

export function createMapButton(address, label = "地図を開く") {
  const link = document.createElement("a");
  link.className = "map-link-button";
  link.textContent = label;
  link.href = googleMapsSearchUrl(address) || "#";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  if (!googleMapsSearchUrl(address)) {
    link.classList.add("disabled");
    link.removeAttribute("target");
    link.addEventListener("click", event => event.preventDefault());
  }
  return link;
}

export function createMapAddressLink(address) {
  const value = String(address || "").trim();
  const link = document.createElement("a");
  link.className = "map-address-link";
  link.textContent = value || "未設定";
  link.href = googleMapsSearchUrl(value) || "#";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  if (!value) {
    link.classList.add("disabled");
    link.removeAttribute("target");
    link.addEventListener("click", event => event.preventDefault());
  }
  return link;
}
