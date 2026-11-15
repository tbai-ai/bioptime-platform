/* The nine font files, loaded at runtime on the web only (useFonts in the root layout registers each under its family
   name, which is also the file's PostScript name). iOS and Android carry the same files natively: the expo-font config
   plugin in app.json embeds them (Android: assets/fonts/<name>.ttf, found by file name; iOS: UIAppFonts, found by
   PostScript name), so a native bundle requires none of them and the APK holds each file once. */
export const FONT_FILES: Record<string, number> = {
  'BebasNeue-Regular': require('@/assets/fonts/BebasNeue-Regular.ttf'),
  'Montserrat-Light': require('@/assets/fonts/Montserrat-Light.ttf'),
  'Montserrat-Regular': require('@/assets/fonts/Montserrat-Regular.ttf'),
  'Montserrat-Medium': require('@/assets/fonts/Montserrat-Medium.ttf'),
  'Montserrat-SemiBold': require('@/assets/fonts/Montserrat-SemiBold.ttf'),
  'Montserrat-Bold': require('@/assets/fonts/Montserrat-Bold.ttf'),
  'JetBrainsMono-Regular': require('@/assets/fonts/JetBrainsMono-Regular.ttf'),
  'JetBrainsMono-Medium': require('@/assets/fonts/JetBrainsMono-Medium.ttf'),
  'JetBrainsMono-Bold': require('@/assets/fonts/JetBrainsMono-Bold.ttf'),
};
