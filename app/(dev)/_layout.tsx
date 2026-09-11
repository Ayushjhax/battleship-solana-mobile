/** Developer-only routes. In a release bundle they redirect to the boot screen. */
import { Redirect, Slot } from 'expo-router';

export default function DevLayout() {
  if (!__DEV__) return <Redirect href="/" />;
  return <Slot />;
}
