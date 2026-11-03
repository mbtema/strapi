# Импорт торговых предложений (Attributes). Скрипт и CSV — на рабочем столе Windows.
# Скачай importer.mjs из этой папки GitHub на рабочий стол.
# Без --apply (dry-run): node --use-system-ca "$env:USERPROFILE\Desktop\importer.mjs"
# Для пилота добавь --only=ТВОЙ_DOCUMENT_ID (без угловых скобок).
# ВНИМАНИЕ: следующая команда с --apply выполняет запись!
node --use-system-ca "$env:USERPROFILE\Desktop\importer.mjs" --apply
