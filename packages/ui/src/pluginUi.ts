import { Button } from './Button';
import { Checkbox } from './Checkbox';
import { Combobox } from './Combobox';
import { IconButton } from './IconButton';
import { Input } from './Input';
import { Modal, ModalFooter, ModalHeader, ModalPanel } from './Modal';
import { Pill } from './Pill';
import { Select } from './Select';
import { Spinner } from './Spinner';
import { Textarea } from './Textarea';

/**
 * The components every SPA surface hands to add-ons, under `window.invflux.<spa>.ui`.
 *
 * An add-on bundle renders on the host's Solid runtime but cannot import `@invflux/ui` itself, so
 * whatever it draws with comes through the surface it registers on. These are the SPA-wide ones:
 * form controls, and the dialog — the {@link Modal} backdrop plus the frame every host dialog is
 * built from ({@link ModalPanel}, {@link ModalHeader}, {@link ModalFooter}), so an add-on's dialog
 * has the same panel, bars and theme as the host's own. Each surface spreads this set into its
 * bridge and adds only what belongs to it (a status pill, a router link); a component every surface
 * should offer is added here, once.
 *
 * Kept apart from `plugin-api.ts`, which imports only registries so it can load without a DOM.
 */
export const sharedPluginUi = {
  Button,
  IconButton,
  Input,
  Select,
  Textarea,
  Checkbox,
  Pill,
  Spinner,
  Combobox,
  Modal,
  ModalPanel,
  ModalHeader,
  ModalFooter,
};

/** The shape of {@link sharedPluginUi}, for a surface's bridge type. */
export type SharedPluginUi = typeof sharedPluginUi;
