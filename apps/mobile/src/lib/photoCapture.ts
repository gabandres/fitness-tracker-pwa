import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

/**
 * Pick an image from the library, downscale to 1080px wide and re-encode as
 * JPEG (0.8) — matches the PWA's resize so uploads land well under the 2 MB
 * / image-jpeg Storage rule — then return the bytes as a Blob ready to
 * upload. Returns null if permission is denied or the user cancels.
 */
export async function pickProgressPhoto(): Promise<Blob | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 1,
    allowsEditing: false,
  });
  if (result.canceled || !result.assets?.length) return null;

  const image = await ImageManipulator.manipulate(result.assets[0].uri)
    .resize({ width: 1080 })
    .renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
  image.release();

  const res = await fetch(saved.uri);
  return await res.blob();
}
