// Lucide icons used by the UI, imported as raw SVG so only these end up in the bundle. The keys are
// the UI's own names (stable when an icon is swapped). Add a name here to use it with <Icon name="…" />.

import activity from "lucide-static/icons/activity.svg?raw";
import arrowLeft from "lucide-static/icons/arrow-left.svg?raw";
import check from "lucide-static/icons/check.svg?raw";
import chevronDown from "lucide-static/icons/chevron-down.svg?raw";
import chevronRight from "lucide-static/icons/chevron-right.svg?raw";
import circleUser from "lucide-static/icons/circle-user.svg?raw";
import copy from "lucide-static/icons/copy.svg?raw";
import ellipsis from "lucide-static/icons/ellipsis.svg?raw";
import history from "lucide-static/icons/history.svg?raw";
import house from "lucide-static/icons/house.svg?raw";
import info from "lucide-static/icons/info.svg?raw";
import keyRound from "lucide-static/icons/key-round.svg?raw";
import languages from "lucide-static/icons/languages.svg?raw";
import link from "lucide-static/icons/link.svg?raw";
import logOut from "lucide-static/icons/log-out.svg?raw";
import monitor from "lucide-static/icons/monitor.svg?raw";
import monitorSmartphone from "lucide-static/icons/monitor-smartphone.svg?raw";
import moon from "lucide-static/icons/moon.svg?raw";
import pencil from "lucide-static/icons/pencil.svg?raw";
import plus from "lucide-static/icons/plus.svg?raw";
import power from "lucide-static/icons/power.svg?raw";
import refreshCw from "lucide-static/icons/refresh-cw.svg?raw";
import router from "lucide-static/icons/router.svg?raw";
import serverCog from "lucide-static/icons/server-cog.svg?raw";
import share2 from "lucide-static/icons/share-2.svg?raw";
import shield from "lucide-static/icons/shield.svg?raw";
import sun from "lucide-static/icons/sun.svg?raw";
import sunMoon from "lucide-static/icons/sun-moon.svg?raw";
import toggleRight from "lucide-static/icons/toggle-right.svg?raw";
import trash2 from "lucide-static/icons/trash-2.svg?raw";
import triangleAlert from "lucide-static/icons/triangle-alert.svg?raw";
import userPlus from "lucide-static/icons/user-plus.svg?raw";
import users from "lucide-static/icons/users.svg?raw";
import x from "lucide-static/icons/x.svg?raw";

export const ICONS = {
  activity,
  add: plus,
  admin: shield,
  "arrow-back": arrowLeft,
  "arrow-drop-down": chevronDown,
  "chevron-right": chevronRight,
  account: circleUser,
  check,
  close: x,
  computer: monitor,
  copy,
  "dark-mode": moon,
  delete: trash2,
  devices: monitorSmartphone,
  dns: serverCog,
  edit: pencil,
  group: users,
  history,
  home: house,
  info,
  key: keyRound,
  "light-mode": sun,
  link,
  logout: logOut,
  more: ellipsis,
  "person-add": userPlus,
  power,
  refresh: refreshCw,
  router,
  share: share2,
  "system-theme": sunMoon,
  toggle: toggleRight,
  translate: languages,
  warning: triangleAlert,
} as const;

export type IconName = keyof typeof ICONS;
