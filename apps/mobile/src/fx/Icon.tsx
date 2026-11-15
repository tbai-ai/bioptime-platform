/* Lucide icons, as the earlier app drew them (THEME §9): nav 22 with stroke 1.5 inactive and 2.5 active, card headers 15–16,
   inline meta 10–12, CTA 18. Each icon is imported from its own module so the bundle carries only these. An icon is
   decorative (hidden from screen readers) unless it is given a label; a control whose only content is an icon carries
   the label itself. Older names used by the module registry (Ionicons, src/lib/modules/*.ts) map to their Lucide
   equivalents, so module entries keep working untouched; an unknown name draws a plain circle, never an error. */
import React from 'react';
import { Platform } from 'react-native';
import type { LucideIcon, LucideIconData } from 'lucide-react-native';
import { fx } from '@/theme';
import House, { __iconData as House__data } from 'lucide-react-native/icons/house';
import Dumbbell, { __iconData as Dumbbell__data } from 'lucide-react-native/icons/dumbbell';
import Dna, { __iconData as Dna__data } from 'lucide-react-native/icons/dna';
import Clock, { __iconData as Clock__data } from 'lucide-react-native/icons/clock';
import Leaf, { __iconData as Leaf__data } from 'lucide-react-native/icons/leaf';
import MessagesSquare, { __iconData as MessagesSquare__data } from 'lucide-react-native/icons/messages-square';
import Microscope, { __iconData as Microscope__data } from 'lucide-react-native/icons/microscope';
import ShoppingBag, { __iconData as ShoppingBag__data } from 'lucide-react-native/icons/shopping-bag';
import User, { __iconData as User__data } from 'lucide-react-native/icons/user';
import Flame, { __iconData as Flame__data } from 'lucide-react-native/icons/flame';
import Zap, { __iconData as Zap__data } from 'lucide-react-native/icons/zap';
import Droplets, { __iconData as Droplets__data } from 'lucide-react-native/icons/droplets';
import Droplet, { __iconData as Droplet__data } from 'lucide-react-native/icons/droplet';
import Moon, { __iconData as Moon__data } from 'lucide-react-native/icons/moon';
import Sun, { __iconData as Sun__data } from 'lucide-react-native/icons/sun';
import Sunrise, { __iconData as Sunrise__data } from 'lucide-react-native/icons/sunrise';
import Sunset, { __iconData as Sunset__data } from 'lucide-react-native/icons/sunset';
import Heart, { __iconData as Heart__data } from 'lucide-react-native/icons/heart';
import HeartPulse, { __iconData as HeartPulse__data } from 'lucide-react-native/icons/heart-pulse';
import Activity, { __iconData as Activity__data } from 'lucide-react-native/icons/activity';
import Footprints, { __iconData as Footprints__data } from 'lucide-react-native/icons/footprints';
import Target, { __iconData as Target__data } from 'lucide-react-native/icons/target';
import Sparkles, { __iconData as Sparkles__data } from 'lucide-react-native/icons/sparkles';
import ChevronLeft, { __iconData as ChevronLeft__data } from 'lucide-react-native/icons/chevron-left';
import ChevronRight, { __iconData as ChevronRight__data } from 'lucide-react-native/icons/chevron-right';
import ChevronDown, { __iconData as ChevronDown__data } from 'lucide-react-native/icons/chevron-down';
import ChevronUp, { __iconData as ChevronUp__data } from 'lucide-react-native/icons/chevron-up';
import X, { __iconData as X__data } from 'lucide-react-native/icons/x';
import Check, { __iconData as Check__data } from 'lucide-react-native/icons/check';
import Circle, { __iconData as Circle__data } from 'lucide-react-native/icons/circle';
import CircleCheck, { __iconData as CircleCheck__data } from 'lucide-react-native/icons/circle-check';
import CircleCheckBig, { __iconData as CircleCheckBig__data } from 'lucide-react-native/icons/circle-check-big';
import Plus, { __iconData as Plus__data } from 'lucide-react-native/icons/plus';
import Minus, { __iconData as Minus__data } from 'lucide-react-native/icons/minus';
import Play, { __iconData as Play__data } from 'lucide-react-native/icons/play';
import Pause, { __iconData as Pause__data } from 'lucide-react-native/icons/pause';
import Volume2, { __iconData as Volume2__data } from 'lucide-react-native/icons/volume-2';
import VolumeX, { __iconData as VolumeX__data } from 'lucide-react-native/icons/volume-x';
import RotateCcw, { __iconData as RotateCcw__data } from 'lucide-react-native/icons/rotate-ccw';
import RotateCw, { __iconData as RotateCw__data } from 'lucide-react-native/icons/rotate-cw';
import ClipboardList, { __iconData as ClipboardList__data } from 'lucide-react-native/icons/clipboard-list';
import ClipboardCheck, { __iconData as ClipboardCheck__data } from 'lucide-react-native/icons/clipboard-check';
import MessageSquare, { __iconData as MessageSquare__data } from 'lucide-react-native/icons/message-square';
import Send, { __iconData as Send__data } from 'lucide-react-native/icons/send';
import Paperclip, { __iconData as Paperclip__data } from 'lucide-react-native/icons/paperclip';
import Calendar, { __iconData as Calendar__data } from 'lucide-react-native/icons/calendar';
import CalendarDays, { __iconData as CalendarDays__data } from 'lucide-react-native/icons/calendar-days';
import CalendarCheck, { __iconData as CalendarCheck__data } from 'lucide-react-native/icons/calendar-check';
import FlaskConical, { __iconData as FlaskConical__data } from 'lucide-react-native/icons/flask-conical';
import Stethoscope, { __iconData as Stethoscope__data } from 'lucide-react-native/icons/stethoscope';
import Shield, { __iconData as Shield__data } from 'lucide-react-native/icons/shield';
import ShieldCheck, { __iconData as ShieldCheck__data } from 'lucide-react-native/icons/shield-check';
import Lock, { __iconData as Lock__data } from 'lucide-react-native/icons/lock';
import Mail, { __iconData as Mail__data } from 'lucide-react-native/icons/mail';
import Smartphone, { __iconData as Smartphone__data } from 'lucide-react-native/icons/smartphone';
import Search, { __iconData as Search__data } from 'lucide-react-native/icons/search';
import Bell, { __iconData as Bell__data } from 'lucide-react-native/icons/bell';
import Settings, { __iconData as Settings__data } from 'lucide-react-native/icons/settings';
import LogOut, { __iconData as LogOut__data } from 'lucide-react-native/icons/log-out';
import Trophy, { __iconData as Trophy__data } from 'lucide-react-native/icons/trophy';
import Award, { __iconData as Award__data } from 'lucide-react-native/icons/award';
import Medal, { __iconData as Medal__data } from 'lucide-react-native/icons/medal';
import ChartColumn, { __iconData as ChartColumn__data } from 'lucide-react-native/icons/chart-column';
import ChartLine, { __iconData as ChartLine__data } from 'lucide-react-native/icons/chart-line';
import FileText, { __iconData as FileText__data } from 'lucide-react-native/icons/file-text';
import Download, { __iconData as Download__data } from 'lucide-react-native/icons/download';
import Upload, { __iconData as Upload__data } from 'lucide-react-native/icons/upload';
import Copy, { __iconData as Copy__data } from 'lucide-react-native/icons/copy';
import MapPin, { __iconData as MapPin__data } from 'lucide-react-native/icons/map-pin';
import Salad, { __iconData as Salad__data } from 'lucide-react-native/icons/salad';
import ChefHat, { __iconData as ChefHat__data } from 'lucide-react-native/icons/chef-hat';
import Trash, { __iconData as Trash__data } from 'lucide-react-native/icons/trash';
import Wifi, { __iconData as Wifi__data } from 'lucide-react-native/icons/wifi';
import WifiOff, { __iconData as WifiOff__data } from 'lucide-react-native/icons/wifi-off';
import Watch, { __iconData as Watch__data } from 'lucide-react-native/icons/watch';
import Wind, { __iconData as Wind__data } from 'lucide-react-native/icons/wind';
import RefreshCw, { __iconData as RefreshCw__data } from 'lucide-react-native/icons/refresh-cw';
import Info, { __iconData as Info__data } from 'lucide-react-native/icons/info';
import TriangleAlert, { __iconData as TriangleAlert__data } from 'lucide-react-native/icons/triangle-alert';
import CircleAlert, { __iconData as CircleAlert__data } from 'lucide-react-native/icons/circle-alert';
import Star, { __iconData as Star__data } from 'lucide-react-native/icons/star';
import ExternalLink, { __iconData as ExternalLink__data } from 'lucide-react-native/icons/external-link';
import Scale, { __iconData as Scale__data } from 'lucide-react-native/icons/scale';
import Ruler, { __iconData as Ruler__data } from 'lucide-react-native/icons/ruler';
import Globe, { __iconData as Globe__data } from 'lucide-react-native/icons/globe';
import Eye, { __iconData as Eye__data } from 'lucide-react-native/icons/eye';
import EyeOff, { __iconData as EyeOff__data } from 'lucide-react-native/icons/eye-off';
import ArrowRight, { __iconData as ArrowRight__data } from 'lucide-react-native/icons/arrow-right';
import ArrowLeft, { __iconData as ArrowLeft__data } from 'lucide-react-native/icons/arrow-left';
import ArrowUpRight, { __iconData as ArrowUpRight__data } from 'lucide-react-native/icons/arrow-up-right';
import Receipt, { __iconData as Receipt__data } from 'lucide-react-native/icons/receipt';
import GraduationCap, { __iconData as GraduationCap__data } from 'lucide-react-native/icons/graduation-cap';
import Megaphone, { __iconData as Megaphone__data } from 'lucide-react-native/icons/megaphone';
import Flag, { __iconData as Flag__data } from 'lucide-react-native/icons/flag';
import Images, { __iconData as Images__data } from 'lucide-react-native/icons/images';
import Image, { __iconData as Image__data } from 'lucide-react-native/icons/image';
import Share2, { __iconData as Share2__data } from 'lucide-react-native/icons/share-2';
import Users, { __iconData as Users__data } from 'lucide-react-native/icons/users';
import CircleQuestionMark, { __iconData as CircleQuestionMark__data } from 'lucide-react-native/icons/circle-question-mark';
import Apple, { __iconData as Apple__data } from 'lucide-react-native/icons/apple';
import LoaderCircle, { __iconData as LoaderCircle__data } from 'lucide-react-native/icons/loader-circle';
import UserRound, { __iconData as UserRound__data } from 'lucide-react-native/icons/user-round';
import CreditCard, { __iconData as CreditCard__data } from 'lucide-react-native/icons/credit-card';
import Package, { __iconData as Package__data } from 'lucide-react-native/icons/package';
import Timer, { __iconData as Timer__data } from 'lucide-react-native/icons/timer';
import ListChecks, { __iconData as ListChecks__data } from 'lucide-react-native/icons/list-checks';
import BadgeCheck, { __iconData as BadgeCheck__data } from 'lucide-react-native/icons/badge-check';
import TrendingUp, { __iconData as TrendingUp__data } from 'lucide-react-native/icons/trending-up';
import TrendingDown, { __iconData as TrendingDown__data } from 'lucide-react-native/icons/trending-down';
import PhoneCall, { __iconData as PhoneCall__data } from 'lucide-react-native/icons/phone-call';
import Video, { __iconData as Video__data } from 'lucide-react-native/icons/video';
import SlidersHorizontal, { __iconData as SlidersHorizontal__data } from 'lucide-react-native/icons/sliders-horizontal';
import Bookmark, { __iconData as Bookmark__data } from 'lucide-react-native/icons/bookmark';
import BookOpen, { __iconData as BookOpen__data } from 'lucide-react-native/icons/book-open';
import Lightbulb, { __iconData as Lightbulb__data } from 'lucide-react-native/icons/lightbulb';
import Hourglass, { __iconData as Hourglass__data } from 'lucide-react-native/icons/hourglass';
import CircleX, { __iconData as CircleX__data } from 'lucide-react-native/icons/circle-x';
import CirclePlus, { __iconData as CirclePlus__data } from 'lucide-react-native/icons/circle-plus';
import CircleMinus, { __iconData as CircleMinus__data } from 'lucide-react-native/icons/circle-minus';
import Pencil, { __iconData as Pencil__data } from 'lucide-react-native/icons/pencil';
import Sparkle, { __iconData as Sparkle__data } from 'lucide-react-native/icons/sparkle';
import Bed, { __iconData as Bed__data } from 'lucide-react-native/icons/bed';
import GlassWater, { __iconData as GlassWater__data } from 'lucide-react-native/icons/glass-water';
import Wheat, { __iconData as Wheat__data } from 'lucide-react-native/icons/wheat';
import Egg, { __iconData as Egg__data } from 'lucide-react-native/icons/egg';
import Beef, { __iconData as Beef__data } from 'lucide-react-native/icons/beef';
import Gift, { __iconData as Gift__data } from 'lucide-react-native/icons/gift';
import Crown, { __iconData as Crown__data } from 'lucide-react-native/icons/crown';
import Tag, { __iconData as Tag__data } from 'lucide-react-native/icons/tag';
import Ticket, { __iconData as Ticket__data } from 'lucide-react-native/icons/ticket';
import HandHeart, { __iconData as HandHeart__data } from 'lucide-react-native/icons/hand-heart';
import Thermometer, { __iconData as Thermometer__data } from 'lucide-react-native/icons/thermometer';
import TestTube, { __iconData as TestTube__data } from 'lucide-react-native/icons/test-tube';
import Pill, { __iconData as Pill__data } from 'lucide-react-native/icons/pill';
import Notebook, { __iconData as Notebook__data } from 'lucide-react-native/icons/notebook';
import List, { __iconData as List__data } from 'lucide-react-native/icons/list';
import Layers, { __iconData as Layers__data } from 'lucide-react-native/icons/layers';
import Inbox, { __iconData as Inbox__data } from 'lucide-react-native/icons/inbox';
import CircleDot, { __iconData as CircleDot__data } from 'lucide-react-native/icons/circle-dot';
import BuildingComplex, { __iconData as BuildingComplex__data } from 'lucide-react-native/icons/building-complex'; // Lucide's 'building-2' is an alias of it (types only)
import Hash, { __iconData as Hash__data } from 'lucide-react-native/icons/hash';
import Signpost, { __iconData as Signpost__data } from 'lucide-react-native/icons/signpost';
import SkipBack, { __iconData as SkipBack__data } from 'lucide-react-native/icons/skip-back';
import SkipForward, { __iconData as SkipForward__data } from 'lucide-react-native/icons/skip-forward';

const REGISTRY = {
  'house': House,
  'dumbbell': Dumbbell,
  'dna': Dna,
  'clock': Clock,
  'leaf': Leaf,
  'messages-square': MessagesSquare,
  'microscope': Microscope,
  'shopping-bag': ShoppingBag,
  'user': User,
  'flame': Flame,
  'zap': Zap,
  'droplets': Droplets,
  'droplet': Droplet,
  'moon': Moon,
  'sun': Sun,
  'sunrise': Sunrise,
  'sunset': Sunset,
  'heart': Heart,
  'heart-pulse': HeartPulse,
  'activity': Activity,
  'footprints': Footprints,
  'target': Target,
  'sparkles': Sparkles,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'chevron-down': ChevronDown,
  'chevron-up': ChevronUp,
  'x': X,
  'check': Check,
  'circle': Circle,
  'circle-check': CircleCheck,
  'circle-check-big': CircleCheckBig,
  'plus': Plus,
  'minus': Minus,
  'play': Play,
  'pause': Pause,
  'volume-2': Volume2,
  'volume-x': VolumeX,
  'rotate-ccw': RotateCcw,
  'rotate-cw': RotateCw,
  'clipboard-list': ClipboardList,
  'clipboard-check': ClipboardCheck,
  'message-square': MessageSquare,
  'send': Send,
  'paperclip': Paperclip,
  'calendar': Calendar,
  'calendar-days': CalendarDays,
  'calendar-check': CalendarCheck,
  'flask-conical': FlaskConical,
  'stethoscope': Stethoscope,
  'shield': Shield,
  'shield-check': ShieldCheck,
  'lock': Lock,
  'mail': Mail,
  'smartphone': Smartphone,
  'search': Search,
  'bell': Bell,
  'settings': Settings,
  'log-out': LogOut,
  'trophy': Trophy,
  'award': Award,
  'medal': Medal,
  'chart-column': ChartColumn,
  'chart-line': ChartLine,
  'file-text': FileText,
  'download': Download,
  'upload': Upload,
  'copy': Copy,
  'map-pin': MapPin,
  'salad': Salad,
  'chef-hat': ChefHat,
  'trash': Trash,
  'wifi': Wifi,
  'wifi-off': WifiOff,
  'watch': Watch,
  'wind': Wind,
  'refresh-cw': RefreshCw,
  'info': Info,
  'triangle-alert': TriangleAlert,
  'circle-alert': CircleAlert,
  'star': Star,
  'external-link': ExternalLink,
  'scale': Scale,
  'ruler': Ruler,
  'globe': Globe,
  'eye': Eye,
  'eye-off': EyeOff,
  'arrow-right': ArrowRight,
  'arrow-left': ArrowLeft,
  'arrow-up-right': ArrowUpRight,
  'receipt': Receipt,
  'graduation-cap': GraduationCap,
  'megaphone': Megaphone,
  'flag': Flag,
  'images': Images,
  'image': Image,
  'share-2': Share2,
  'users': Users,
  'circle-question-mark': CircleQuestionMark,
  'apple': Apple,
  'loader-circle': LoaderCircle,
  'user-round': UserRound,
  'credit-card': CreditCard,
  'package': Package,
  'timer': Timer,
  'list-checks': ListChecks,
  'badge-check': BadgeCheck,
  'trending-up': TrendingUp,
  'trending-down': TrendingDown,
  'phone-call': PhoneCall,
  'video': Video,
  'sliders-horizontal': SlidersHorizontal,
  'bookmark': Bookmark,
  'book-open': BookOpen,
  'lightbulb': Lightbulb,
  'hourglass': Hourglass,
  'circle-x': CircleX,
  'circle-plus': CirclePlus,
  'circle-minus': CircleMinus,
  'pencil': Pencil,
  'sparkle': Sparkle,
  'bed': Bed,
  'glass-water': GlassWater,
  'wheat': Wheat,
  'egg': Egg,
  'beef': Beef,
  'gift': Gift,
  'crown': Crown,
  'tag': Tag,
  'ticket': Ticket,
  'hand-heart': HandHeart,
  'thermometer': Thermometer,
  'test-tube': TestTube,
  'pill': Pill,
  'circle-dot': CircleDot,
  'inbox': Inbox,
  'layers': Layers,
  'list': List,
  'notebook': Notebook,
  'building-2': BuildingComplex,
  'building-complex': BuildingComplex,
  'hash': Hash,
  'signpost': Signpost,
  'skip-back': SkipBack,
  'skip-forward': SkipForward,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof REGISTRY;

/** Each glyph's drawing (the icon module's `__iconData.node`), for a component that draws the paths itself (the tab
 *  bar's TabIcon animates their stroke on the UI thread). */
const NODES = new Map<LucideIcon, LucideIconData['node']>([
  [House, House__data.node],
  [Dumbbell, Dumbbell__data.node],
  [Dna, Dna__data.node],
  [Clock, Clock__data.node],
  [Leaf, Leaf__data.node],
  [MessagesSquare, MessagesSquare__data.node],
  [Microscope, Microscope__data.node],
  [ShoppingBag, ShoppingBag__data.node],
  [User, User__data.node],
  [Flame, Flame__data.node],
  [Zap, Zap__data.node],
  [Droplets, Droplets__data.node],
  [Droplet, Droplet__data.node],
  [Moon, Moon__data.node],
  [Sun, Sun__data.node],
  [Sunrise, Sunrise__data.node],
  [Sunset, Sunset__data.node],
  [Heart, Heart__data.node],
  [HeartPulse, HeartPulse__data.node],
  [Activity, Activity__data.node],
  [Footprints, Footprints__data.node],
  [Target, Target__data.node],
  [Sparkles, Sparkles__data.node],
  [ChevronLeft, ChevronLeft__data.node],
  [ChevronRight, ChevronRight__data.node],
  [ChevronDown, ChevronDown__data.node],
  [ChevronUp, ChevronUp__data.node],
  [X, X__data.node],
  [Check, Check__data.node],
  [Circle, Circle__data.node],
  [CircleCheck, CircleCheck__data.node],
  [CircleCheckBig, CircleCheckBig__data.node],
  [Plus, Plus__data.node],
  [Minus, Minus__data.node],
  [Play, Play__data.node],
  [Pause, Pause__data.node],
  [Volume2, Volume2__data.node],
  [VolumeX, VolumeX__data.node],
  [RotateCcw, RotateCcw__data.node],
  [RotateCw, RotateCw__data.node],
  [ClipboardList, ClipboardList__data.node],
  [ClipboardCheck, ClipboardCheck__data.node],
  [MessageSquare, MessageSquare__data.node],
  [Send, Send__data.node],
  [Paperclip, Paperclip__data.node],
  [Calendar, Calendar__data.node],
  [CalendarDays, CalendarDays__data.node],
  [CalendarCheck, CalendarCheck__data.node],
  [FlaskConical, FlaskConical__data.node],
  [Stethoscope, Stethoscope__data.node],
  [Shield, Shield__data.node],
  [ShieldCheck, ShieldCheck__data.node],
  [Lock, Lock__data.node],
  [Mail, Mail__data.node],
  [Smartphone, Smartphone__data.node],
  [Search, Search__data.node],
  [Bell, Bell__data.node],
  [Settings, Settings__data.node],
  [LogOut, LogOut__data.node],
  [Trophy, Trophy__data.node],
  [Award, Award__data.node],
  [Medal, Medal__data.node],
  [ChartColumn, ChartColumn__data.node],
  [ChartLine, ChartLine__data.node],
  [FileText, FileText__data.node],
  [Download, Download__data.node],
  [Upload, Upload__data.node],
  [Copy, Copy__data.node],
  [MapPin, MapPin__data.node],
  [Salad, Salad__data.node],
  [ChefHat, ChefHat__data.node],
  [Trash, Trash__data.node],
  [Wifi, Wifi__data.node],
  [WifiOff, WifiOff__data.node],
  [Watch, Watch__data.node],
  [Wind, Wind__data.node],
  [RefreshCw, RefreshCw__data.node],
  [Info, Info__data.node],
  [TriangleAlert, TriangleAlert__data.node],
  [CircleAlert, CircleAlert__data.node],
  [Star, Star__data.node],
  [ExternalLink, ExternalLink__data.node],
  [Scale, Scale__data.node],
  [Ruler, Ruler__data.node],
  [Globe, Globe__data.node],
  [Eye, Eye__data.node],
  [EyeOff, EyeOff__data.node],
  [ArrowRight, ArrowRight__data.node],
  [ArrowLeft, ArrowLeft__data.node],
  [ArrowUpRight, ArrowUpRight__data.node],
  [Receipt, Receipt__data.node],
  [GraduationCap, GraduationCap__data.node],
  [Megaphone, Megaphone__data.node],
  [Flag, Flag__data.node],
  [Images, Images__data.node],
  [Image, Image__data.node],
  [Share2, Share2__data.node],
  [Users, Users__data.node],
  [CircleQuestionMark, CircleQuestionMark__data.node],
  [Apple, Apple__data.node],
  [LoaderCircle, LoaderCircle__data.node],
  [UserRound, UserRound__data.node],
  [CreditCard, CreditCard__data.node],
  [Package, Package__data.node],
  [Timer, Timer__data.node],
  [ListChecks, ListChecks__data.node],
  [BadgeCheck, BadgeCheck__data.node],
  [TrendingUp, TrendingUp__data.node],
  [TrendingDown, TrendingDown__data.node],
  [PhoneCall, PhoneCall__data.node],
  [Video, Video__data.node],
  [SlidersHorizontal, SlidersHorizontal__data.node],
  [Bookmark, Bookmark__data.node],
  [BookOpen, BookOpen__data.node],
  [Lightbulb, Lightbulb__data.node],
  [Hourglass, Hourglass__data.node],
  [CircleX, CircleX__data.node],
  [CirclePlus, CirclePlus__data.node],
  [CircleMinus, CircleMinus__data.node],
  [Pencil, Pencil__data.node],
  [Sparkle, Sparkle__data.node],
  [Bed, Bed__data.node],
  [GlassWater, GlassWater__data.node],
  [Wheat, Wheat__data.node],
  [Egg, Egg__data.node],
  [Beef, Beef__data.node],
  [Gift, Gift__data.node],
  [Crown, Crown__data.node],
  [Tag, Tag__data.node],
  [Ticket, Ticket__data.node],
  [HandHeart, HandHeart__data.node],
  [Thermometer, Thermometer__data.node],
  [TestTube, TestTube__data.node],
  [Pill, Pill__data.node],
  [Notebook, Notebook__data.node],
  [List, List__data.node],
  [Layers, Layers__data.node],
  [Inbox, Inbox__data.node],
  [CircleDot, CircleDot__data.node],
  [Hash, Hash__data.node],
  [Signpost, Signpost__data.node],
  [SkipBack, SkipBack__data.node],
  [SkipForward, SkipForward__data.node],
  [BuildingComplex, BuildingComplex__data.node],
]);

/** Names used in the plans or by the earlier app that Lucide has since renamed. */
const ALIASES: Record<string, IconName> = {
  'bar-chart-3': 'chart-column', 'trash-2': 'trash', 'alert-triangle': 'triangle-alert', 'alert-circle': 'circle-alert',
  'help-circle': 'circle-question-mark', home: 'house', 'check-circle': 'circle-check', 'x-circle': 'circle-x',
  'plus-circle': 'circle-plus', 'minus-circle': 'circle-minus', loader: 'loader-circle',
};

/** The Ionicons names in the module registry (src/lib/modules/*.ts, frozen) → Lucide. */
export const IONICONS_TO_LUCIDE: Record<string, IconName> = {
  'shield-checkmark-outline': 'shield-check',
  'receipt-outline': 'receipt',
  'checkmark-circle-outline': 'circle-check',
  'flask-outline': 'flask-conical',
  'school-outline': 'graduation-cap',
  'megaphone-outline': 'megaphone',
  'stats-chart-outline': 'chart-column',
  'flag-outline': 'flag',
  'images-outline': 'images',
  'share-social-outline': 'share-2',
  'nutrition-outline': 'apple',
  'people-outline': 'users',
  'barbell-outline': 'dumbbell',
  'time-outline': 'clock',
  'help-circle-outline': 'circle-question-mark',
};

/** The Lucide icon for any name the app uses (kit name, alias or Ionicons name); null when unknown. */
export function iconFor(name: string): LucideIcon | null {
  const key = (name in REGISTRY ? name : ALIASES[name] ?? IONICONS_TO_LUCIDE[name]) as IconName | undefined;
  return key ? REGISTRY[key] : null;
}

export type IconProps = {
  name: IconName | (string & {});
  size?: number;
  color?: string;
  /** Stroke width (Lucide default 2). */
  stroke?: number;
  /** Lucide's `fill`, for the earlier app's filled play glyphs. */
  fill?: string;
  /** Set only when the icon is the sole content that explains something; otherwise it is hidden from screen readers. */
  label?: string;
};

export function Icon({ name, size = 16, color = fx.ink.white, stroke = 2, fill, label }: IconProps) {
  const Glyph = iconFor(name) ?? REGISTRY.circle;
  // react-native-svg hands its props to the DOM on the web, so there only the ARIA attributes are passed
  const a11y = Platform.OS === 'web'
    ? (label ? { role: 'img' as const, 'aria-label': label } : { 'aria-hidden': true as const })
    : label ? { accessible: true, accessibilityLabel: label, accessibilityRole: 'image' as const } : { accessible: false, importantForAccessibility: 'no-hide-descendants' as const };
  return <Glyph size={size} color={color} strokeWidth={stroke} fill={fill ?? 'none'} {...a11y} />;
}

/** A glyph's elements as lucide draws them ([tag, attributes] pairs: path, circle, rect, line, polyline…), resolving the
 *  same registry and aliases as Icon; null for an unknown name. */
export function iconNode(name: string): ReadonlyArray<[string, Record<string, string | number>]> | null {
  const glyph = iconFor(name);
  const node = glyph ? NODES.get(glyph) : undefined;
  return node ? (node as unknown as ReadonlyArray<[string, Record<string, string | number>]>) : null;
}
