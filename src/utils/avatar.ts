/** Extract an avatar URL from a Converse vCard-like model or plain object. */
export function getAvatar(vcard: unknown): string {
  if (!vcard || typeof vcard !== 'object') return '';

  const getter = Reflect.get(vcard, 'get');
  const get = typeof getter === 'function'
    ? (attr: string): unknown => Reflect.apply(getter, vcard, [attr])
    : null;

  const rawAttributes = Reflect.get(vcard, 'attributes');
  const attributes = rawAttributes && typeof rawAttributes === 'object' ? rawAttributes : null;

  const image = get?.('image') ??
    (attributes && 'image' in attributes ? attributes.image : undefined);
  if (typeof image !== 'string' || !image) return '';
  if (image.startsWith('data:') || image.startsWith('http') || image.startsWith('blob:')) {
    return image;
  }

  const typeValue = get?.('image_type') ??
    (attributes && 'image_type' in attributes ? attributes.image_type : undefined);
  const type = typeof typeValue === 'string' && typeValue ? typeValue : 'image/png';
  return `data:${type};base64,${image}`;
}
