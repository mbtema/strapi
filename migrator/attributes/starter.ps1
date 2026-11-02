# Импорт торговых предложений (Attributes). Скрипт и CSV — на рабочем столе Windows.
# Без --apply: node --use-system-ca "$env:USERPROFILE\Desktop\attributes-importer.mjs"
# Безопасный пилот: добавить --only=<documentId> к команде ниже.
node --use-system-ca "$env:USERPROFILE\Desktop\attributes-importer.mjs" --apply
