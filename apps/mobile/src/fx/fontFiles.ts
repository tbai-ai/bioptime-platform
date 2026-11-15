/* iOS and Android: nothing to load at runtime. The expo-font config plugin (app.json) embeds the nine files in the
   native app (Android assets/fonts, iOS UIAppFonts), and every style names them by family (src/fx/type FONTS), so the
   JS bundle requires no font file and the app holds each one once. The web loads them from ./fontFiles.web.ts. */
export const FONT_FILES: Record<string, number> = {};
