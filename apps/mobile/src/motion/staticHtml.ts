/* Whether a motion primitive is part of a page the web build rendered ahead of time. app.json sets web.output 'static',
   so on the web every route is rendered to HTML at build time (or per request by the dev server) and the browser then
   hydrates that HTML. Whatever the HTML holds must already be at rest: an entrance's starting state (opacity 0) would
   leave the page invisible until the JavaScript loads, and for good if it never does. So on the web a primitive in the
   server render or in the hydration pass starts at rest and plays no entrance, while one that mounts afterwards (a
   screen opened in the app) animates as usual. Native has no server render: there this is always false and every
   entrance plays as it always has.

   React answers the question itself: useSyncExternalStore returns the server snapshot during the server render and
   during hydration, and the client snapshot for anything rendered after. The answer is fixed when the primitive mounts.
   This file depends on React alone (the caller passes whether it runs on the web), so it can be tested in Node. */
import { useState, useSyncExternalStore } from 'react';

const subscribe = () => () => {};
const onClient = () => true;
const onServer = () => false;

export function useInStaticHtml(web: boolean): boolean {
  const client = useSyncExternalStore(subscribe, onClient, onServer);
  const [inHtml] = useState(() => web && !client);
  return inHtml;
}
