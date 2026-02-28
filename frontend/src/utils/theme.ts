export function isDarkMode(): boolean {
  return document.documentElement.classList.contains("dark");
}

export function toggleDarkMode(): boolean {
  const html = document.documentElement;
  const dark = html.classList.toggle("dark");
  localStorage.setItem("theme", dark ? "dark" : "light");
  return dark;
}
