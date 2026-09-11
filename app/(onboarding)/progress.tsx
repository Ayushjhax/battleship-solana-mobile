/** Local save vs cloud save — docs/brief.md 4.5. Built in P10. */
import { Text, View } from 'react-native';

import { Scale } from '@/ui/Scale';
import { color, font, type as typeScale } from '@/ui/tokens';

export default function ProgressScreen() {
  return (
    <Scale>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: color.paper, fontFamily: font.display, fontSize: typeScale.lg }}>
          Game progress
        </Text>
      </View>
    </Scale>
  );
}
