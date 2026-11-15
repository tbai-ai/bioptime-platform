/* The client app's kit (the owner's earlier app's look, made premium). Every client screen imports from '@/fx' (and '@/lib/*'),
   never from '@/components/ui' (the staff kit) or the staff `colors`. Tokens are `fx` in src/theme.ts.
   - Core (this package): type and text, icons, glass cards, buttons, inputs, chips, segmented controls, toggles,
     checks, options, the stepper, toasts, sheets, screen and overlay chrome (and the stack's own header for screens
     without any), notices, error and empty states, pills, avatars, icon tiles, dividers, rows, scrims; the tab pager and bar (./nav); data refresh and updates (./data); haptics, device
     settings and steps (./device); photos and server media (./media).
   - Premium motion (./motion) and the Bioptime brand sting (./brand), their own package, re-exported here.
   The gallery at /__fx (development builds) shows every component in its states. */
export { fx } from '@/theme';

export { FONTS, FONT_FILES, fontFor, type as typeScale, maxScaleFor, type TypeVariant } from './type';
export { useFx, tk, springBar, type FxEffects } from './effects';
export { COLUMN, navBottom, navClearance, useLayout, type Layout } from './layout';
export { T, P, Eyebrow, H, type TProps } from './Text';
export { Icon, iconFor, IONICONS_TO_LUCIDE, type IconName, type IconProps } from './Icon';
export { Scrim, RadialGlow, type ScrimKind } from './Gradient';
export { GlassCard, type GlassCardProps, type GlassVariant } from './GlassCard';
export { AnimatedPressable, afterPaint, usePress, PRESS, type PressKind } from './press';
export { Button, IconButton, RingSpinner, type ButtonProps, type ButtonVariant, type IconButtonKind } from './Button';
export { Field, Input, IconInput, SearchInput, NumberInput, type InputProps } from './Field';
export { OtpBoxes } from './OtpBoxes';
export { VerifiedOverlay } from './Verified';
export { FilterChip, ColorTab, Tag, SuggestionChip, DateChip, PhotoTag } from './Chip';
export { Segmented, type SegmentItem } from './Segmented';
export { EdgeCue, PillTabs, SwitchView, type PillTab } from './PillTabs';
export { Toggle } from './Toggle';
export { Check, CheckBox, ConsentCard } from './Check';
export { OptionCard, GoalTile } from './OptionCard';
export { Stepper } from './Stepper';
export { toast, ToastHost, useToastClearance } from './Toast';
export { Sheet, SheetHost, SheetPanel, SheetScreen, SheetBackdrop, useSheetOpen, type SheetOptions, type SheetKind } from './Sheet';
export { ScreenHeader, type HeaderPhoto } from './ScreenHeader';
export { Overlay, closeOverlay } from './Overlay';
export { StackHeader, BackHeader, renderStackHeader, ownerTab, titleFromRoute, goBackOr } from './StackHeader';
export { TabScreen, TabTitleBar, FlowScreen, FlowEnter, useTabScroll, ScrollAnchor, useScrollToAnchor } from './FxScreen';
export { StatusScrim, STATUS_SOLID_AFTER } from './StatusScrim';
export { Notice, NoticeText, type NoticeKind } from './Notice';
export { ErrorState, StaleBanner } from './ErrorState';
export { EmptyState, type EmptyAction } from './EmptyState';
export { Pill, statusTone, withAlpha, type PillTone } from './StatusPill';
export { Avatar, Medallion, initialsOf, hueOf } from './Avatar';
export { IconTile } from './IconTile';
export { TitledDivider, RowDivider } from './Divider';
export { SettingsRow, KVRow, Accordion } from './ListRow';

export { TABS, HIDDEN_TABS, type TabDef, type TabName } from './nav/tabs';
export { usePager, useSwipeLock, NoSwipeZone } from './nav/Pager';
export { useTabRoutes, tabHrefIn } from './nav/routes';
export { useOwnChrome, OwnChrome } from './nav/chrome';

export { useFocusRefresh } from './data/useFocusRefresh';
export { useUpdates, onUpdate, pollUpdates, resetUpdates, type AppNotification, type Updates } from './data/useUpdates';

export { haptics } from './device/haptics';
export { loadDeviceSettings, peekSetting, setSetting, readKeyed, writeKeyed, useDeviceSetting, deviceSettingsLoaded, type DeviceSettings, type DeviceSettingKey, type MotionTier, type StepBuffer } from './device/settings';
export { useStepCounter, useLiveStepsToday, syncSteps, type StepCounter, type StepStatus } from './device/steps';

export { Photo, photoIdFor, photoRecord, allPhotos, type PhotoProps } from './media/Photo';
export { RemotePhoto } from './media/RemotePhoto';
export { RemoteVideo, useRemoteVideo, videoSource } from './media/RemoteVideo';
export type { PhotoRecord, PhotoCredit, PhotoTint, PhotoSource, PhotosModule, SlotsModule } from './media/types';

export { prefetch, invalidate, onInvalidate } from '@/lib/useLoad';

export * from './motion';
export * from './brand';
