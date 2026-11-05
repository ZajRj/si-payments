import { audit } from '../../lib/audit.js';
import { HttpError } from '../../lib/http-error.js';
import { prisma } from '../../lib/prisma.js';
import { isSettingKey, SETTINGS, type SettingKey } from './settings.definitions.js';

export async function listSettings() {
  const stored = new Map((await prisma.setting.findMany()).map((setting) => [setting.key, setting]));

  return (Object.keys(SETTINGS) as SettingKey[]).map((key) => ({
    key,
    label: SETTINGS[key].label,
    description: SETTINGS[key].description,
    value: stored.get(key)?.value ?? SETTINGS[key].defaultValue,
    updatedAt: stored.get(key)?.updatedAt ?? null,
  }));
}

export async function updateSetting(actorId: number, key: string, value: string) {
  if (!isSettingKey(key)) {
    throw new HttpError(404, 'SETTING_NOT_FOUND', 'Parámetro no encontrado');
  }

  return prisma.$transaction(async (tx) => {
    const before = await tx.setting.findUnique({ where: { key } });
    const setting = await tx.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
    await audit(tx, {
      userId: actorId,
      action: before ? 'UPDATE' : 'CREATE',
      entity: 'Setting',
      entityId: key,
      before: before ?? undefined,
      after: setting,
    });
    return setting;
  });
}
