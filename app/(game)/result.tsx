/** Result and rewards. Built in P15 — see docs/prompts.md. */
import { Text, View } from 'react-native';

import { Scale } from '@/ui/Scale';
import { color, font, type as typeScale } from '@/ui/tokens';

export default function ResultScreen() {
  return (
    <Scale>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: color.paper, fontFamily: font.display, fontSize: typeScale.lg }}>
          Result
        </Text>
      </View>
    </Scale>
  );
}
