/* Alert.alert for every confirmation in the app. On iOS and Android it opens the kit's glass sheet (src/fx/ConfirmHost,
   SMA-5: the system's grey dialog broke the app's look at sign-out), or React Native's own Alert while no host is
   mounted. On the web React Native's Alert does nothing, so a question with a cancel button and one action uses the
   browser's confirm dialog (OK runs the action, Cancel runs the cancel button), and a plain notice uses the browser's
   alert. */
import { Alert as NativeAlert, Platform, type AlertButton } from 'react-native';
import { confirmHostReady, showConfirm } from '@/fx/ConfirmHost';

type BrowserDialogs = { confirm(message: string): boolean; alert(message: string): void };

export const Alert = {
  alert(title: string, message?: string, buttons?: AlertButton[]): void {
    if (Platform.OS !== 'web') {
      if (confirmHostReady()) showConfirm(title, message, buttons); else NativeAlert.alert(title, message, buttons);
      return;
    }
    const dialogs = globalThis as unknown as BrowserDialogs;
    const text = message ? `${title}\n\n${message}` : title;
    const cancel = buttons?.find((b) => b.style === 'cancel');
    const action = buttons?.find((b) => b.style !== 'cancel');
    if (!cancel) { dialogs.alert(text); action?.onPress?.(); return; }
    if (dialogs.confirm(text)) action?.onPress?.(); else cancel.onPress?.();
  },
};
