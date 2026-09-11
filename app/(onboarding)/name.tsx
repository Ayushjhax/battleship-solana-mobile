/** Choose a name. Built in P10 — see docs/prompts.md. */
import { Text, View } from 'react-native';

import { Scale } from '@/ui/Scale';
import { color, font, type as typeScale } from '@/ui/tokens';

export default function NameScreen() {
  return (
    <Scale>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: color.paper, fontFamily: font.display, fontSize: typeScale.lg }}>
          Choose a name
        </Text>
      </View>
    </Scale>
  );
}
