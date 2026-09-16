declare module 'react-native-qrcode-styled' {
  import type { ComponentType } from 'react';
  import type { ColorValue, StyleProp, ViewStyle } from 'react-native';

  interface QRCodeStyledProps {
    data: string;
    pieceSize?: number;
    pieceScale?: number;
    pieceCornerType?: 'rounded' | 'cut';
    color?: ColorValue;
    backgroundColor?: ColorValue;
    padding?: number;
    style?: StyleProp<ViewStyle>;
  }

  const QRCodeStyled: ComponentType<QRCodeStyledProps>;
  export default QRCodeStyled;
}
