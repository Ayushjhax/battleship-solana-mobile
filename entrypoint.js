// Privy's required React Native polyfills must run before Expo Router or Solana.
import 'fast-text-encoding';
import 'react-native-get-random-values';
import { Buffer } from 'buffer';

global.Buffer = Buffer;

import '@ethersproject/shims';
import 'expo-router/entry';
