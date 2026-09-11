/** Matchmaking. Built in P13 — see docs/prompts.md. */
import { Text, View } from 'react-native';

import { Scale } from '@/ui/Scale';
import { color, font, type as typeScale } from '@/ui/tokens';

export default function SearchingScreen() {
  return (
    <Scale>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: color.paper, fontFamily: font.display, fontSize: typeScale.lg }}>
          Searching for an opponent
        </Text>
      </View>
    </Scale>
  );
}
