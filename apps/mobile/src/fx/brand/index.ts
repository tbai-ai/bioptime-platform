/* The Bioptime brand in the client app: the mark, wordmark, tagline and lockup drawn from the brand's own vectors
   (./markData.ts, transcribed from ~/Desktop/drive/brand), the splash sting and the mark's hand-off to the next screen. */
export { MarkPaths, MarkShapes, markColors, type ArtProps } from './MarkPaths';
export { Wordmark, Tagline, Lockup, WORDMARK_BOX, TAGLINE_BOX } from './Wordmark';
export { SplashSting, type SplashStingProps } from './SplashSting';
export { MarkHandoff, hasMarkHandoff, recordMarkHandoff, type HandoffTarget } from './MarkHandoff';
export { SplashHost, startSplash, useSplashState, type SplashState } from './SplashHost';
export { MARK_BOX, LOCKUP_BOX } from './markData';
