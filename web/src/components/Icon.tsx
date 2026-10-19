/**
 * The app's icon set, backed by lucide-react. Pages use app-level names
 * (`'camera'`, `'sync'`), so swapping the vendor is a change to this file alone.
 * One 24x24 grid, 1.75 stroke, `currentColor` only; `aria-hidden` by default
 * (an icon never carries meaning alone, pass `title` for the rare standalone
 * case). Only the icons mapped below ship.
 */
import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BarChart3,
  Calendar,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  Download,
  ImageOff,
  Info,
  LayoutDashboard,
  Menu,
  List,
  Lock,
  LogOut,
  Languages,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Tag,
  Trash2,
  Upload,
  User,
  Users,
  Video,
  WifiOff,
  X,
  type LucideIcon,
} from 'lucide-react';

export type IconName =
  | 'camera'
  | 'video'
  | 'check'
  | 'checkCircle'
  | 'alertTriangle'
  | 'alertCircle'
  | 'info'
  | 'clock'
  | 'sync'
  | 'offline'
  | 'imageOff'
  | 'x'
  | 'plus'
  | 'trash'
  | 'upload'
  | 'pencil'
  | 'search'
  | 'download'
  | 'chevronLeft'
  | 'chevronRight'
  | 'chevronDown'
  | 'arrowUp'
  | 'arrowDown'
  | 'clipboard'
  | 'list'
  | 'menu'
  | 'chart'
  | 'grid'
  | 'users'
  | 'user'
  | 'tag'
  | 'language'
  | 'signOut'
  | 'lock'
  | 'settings'
  | 'calendar';

const ICONS: Record<IconName, LucideIcon> = {
  camera: Camera,
  video: Video,
  check: Check,
  checkCircle: CheckCircle2,
  alertTriangle: AlertTriangle,
  alertCircle: AlertCircle,
  info: Info,
  clock: Clock,
  sync: RefreshCw,
  offline: WifiOff,
  imageOff: ImageOff,
  x: X,
  plus: Plus,
  trash: Trash2,
  upload: Upload,
  pencil: Pencil,
  search: Search,
  download: Download,
  chevronLeft: ChevronLeft,
  chevronRight: ChevronRight,
  chevronDown: ChevronDown,
  arrowUp: ArrowUp,
  arrowDown: ArrowDown,
  clipboard: ClipboardList,
  list: List,
  menu: Menu,
  chart: BarChart3,
  grid: LayoutDashboard,
  users: Users,
  user: User,
  tag: Tag,
  language: Languages,
  signOut: LogOut,
  lock: Lock,
  settings: Settings,
  calendar: Calendar,
};

/**
 * Icons that point along the reading direction (back, forward, next). They are
 * mirrored under `dir="rtl"` here, in one place. Vertical arrows are left alone.
 */
const FLIP_IN_RTL: ReadonlySet<IconName> = new Set(['chevronLeft', 'chevronRight']);

interface Props {
  name: IconName;
  size?: number;
  className?: string;
  /** Only for a standalone icon with no adjacent label — renders a <title>. */
  title?: string;
  strokeWidth?: number;
}

export default function Icon({ name, size = 20, className, title, strokeWidth = 1.75 }: Props) {
  const Glyph = ICONS[name];
  return (
    <Glyph
      width={size}
      height={size}
      strokeWidth={strokeWidth}
      className={`${FLIP_IN_RTL.has(name) ? 'rtl:-scale-x-100' : ''} ${className ?? ''}`.trim()}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      aria-label={title}
      focusable="false"
    />
  );
}
