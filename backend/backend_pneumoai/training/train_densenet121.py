# ============================================================
# PIPELINE CORRIGIDO - CNN DenseNet121 para Pneumonia (Chest X-Ray)
# ============================================================

# ---------- 0. Instalação (descomente se necessário) ----------
# !pip install -q shap kagglehub

# ---------- 1. Imports ----------
import os
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
import tensorflow as tf
import shap
import kagglehub

from tensorflow.keras import layers
from tensorflow.keras.applications import DenseNet121
from sklearn.metrics import (
    confusion_matrix,
    classification_report,
    f1_score,
    recall_score,
)
from sklearn.utils.class_weight import compute_class_weight

# Reprodutibilidade
SEED = 42
tf.keras.utils.set_random_seed(SEED)
np.random.seed(SEED)

# ---------- 2. Download do dataset ----------
DATASET_PATH = kagglehub.dataset_download("paultimothymooney/chest-xray-pneumonia")
print("Path to dataset files:", DATASET_PATH)

base_dir = os.path.join(DATASET_PATH, "chest_xray")
train_dir = os.path.join(base_dir, "train")
test_dir  = os.path.join(base_dir, "test")
# A pasta "val" original tem apenas ~16 imagens -> inútil, ignorada.

# ---------- 3. Hiperparâmetros ----------
IMG_HEIGHT = 224
IMG_WIDTH  = 224
BATCH_SIZE = 32
VALIDATION_SPLIT = 0.15   # 15% do train vai para validação
AUTOTUNE = tf.data.AUTOTUNE

# ---------- 4. Datasets ----------
# TRAIN: split interno (validação honesta, separada do test)
train_dataset = tf.keras.utils.image_dataset_from_directory(
    train_dir,
    validation_split=VALIDATION_SPLIT,
    subset="training",
    seed=SEED,
    image_size=(IMG_HEIGHT, IMG_WIDTH),
    batch_size=BATCH_SIZE,
    label_mode="binary",
    shuffle=True,
)

validation_dataset = tf.keras.utils.image_dataset_from_directory(
    train_dir,
    validation_split=VALIDATION_SPLIT,
    subset="validation",
    seed=SEED,
    image_size=(IMG_HEIGHT, IMG_WIDTH),
    batch_size=BATCH_SIZE,
    label_mode="binary",
    shuffle=False,
)

# TEST: só será usado UMA vez, no final
test_dataset = tf.keras.utils.image_dataset_from_directory(
    test_dir,
    image_size=(IMG_HEIGHT, IMG_WIDTH),
    batch_size=BATCH_SIZE,
    label_mode="binary",
    shuffle=False,
)

class_names = train_dataset.class_names
print(f"\nClasses: {class_names}")

# ---------- 5. Normalização + cache/prefetch ----------
def normalize(image, label):
    image = tf.cast(image, tf.float32) / 255.0
    return image, label

train_dataset      = train_dataset.map(normalize,      num_parallel_calls=AUTOTUNE).cache().prefetch(AUTOTUNE)
validation_dataset = validation_dataset.map(normalize, num_parallel_calls=AUTOTUNE).cache().prefetch(AUTOTUNE)
test_dataset       = test_dataset.map(normalize,       num_parallel_calls=AUTOTUNE).cache().prefetch(AUTOTUNE)

# ---------- 6. Class weights ----------
# Usa o dataset de treino (subset="training") — já shuffle=True
y_train = np.concatenate([y.numpy() for _, y in train_dataset], axis=0).flatten()

classes = np.unique(y_train)
weights = compute_class_weight("balanced", classes=classes, y=y_train)
class_weights_dict = {int(c): float(w) for c, w in zip(classes, weights)}
print("Class weights:", class_weights_dict)

# ---------- 7. Visualização rápida ----------
for images_batch, labels_batch in train_dataset.take(1):
    plt.figure(figsize=(10, 10))
    for i in range(min(15, len(images_batch))):
        plt.subplot(5, 5, i + 1)
        plt.xticks([]); plt.yticks([])
        plt.imshow(images_batch[i].numpy())
        plt.xlabel(class_names[int(labels_batch[i].numpy()[0])])
    plt.tight_layout()
    plt.show()

# ---------- 8. Augmentation (mais robusta) ----------
data_augmentation = tf.keras.Sequential([
    layers.RandomFlip("horizontal"),
    layers.RandomRotation(0.05),
    layers.RandomZoom(0.07),
    layers.RandomContrast(0.10),
], name="data_augmentation")

# ---------- 9. Base model + fine-tuning ----------
base_model = DenseNet121(
    input_shape=(IMG_HEIGHT, IMG_WIDTH, 3),
    include_top=False,
    weights="imagenet",
)
base_model.trainable = True
for layer in base_model.layers[:-30]:   # congela tudo exceto as últimas 30
    layer.trainable = False

# ---------- 10. Modelo ----------
model = tf.keras.Sequential([
    tf.keras.layers.Input(shape=(IMG_HEIGHT, IMG_WIDTH, 3), name="input_image"),
    data_augmentation,
    base_model,
    tf.keras.layers.GlobalAveragePooling2D(),
    tf.keras.layers.Dense(256, activation="relu",
                          kernel_regularizer=tf.keras.regularizers.l2(1e-4)),
    tf.keras.layers.Dropout(0.4),
    tf.keras.layers.Dense(128, activation="relu",
                          kernel_regularizer=tf.keras.regularizers.l2(1e-4)),
    tf.keras.layers.Dropout(0.4),
    tf.keras.layers.Dense(1, activation="sigmoid"),
], name="densenet121_pneumonia")

model.summary()

# ---------- 11. Compilação com LR diferenciado ----------
# LR maior para a cabeça nova, LR menor para o backbone pré-treinado
optimizer = tf.keras.optimizers.Adam(learning_rate=1e-4)

model.compile(
    optimizer=optimizer,
    loss="binary_crossentropy",
    metrics=["accuracy",
             tf.keras.metrics.AUC(name="auc"),
             tf.keras.metrics.Recall(name="recall"),
             tf.keras.metrics.Precision(name="precision")],
)

# ---------- 12. Callbacks ----------
callbacks = [
    tf.keras.callbacks.EarlyStopping(
        monitor="val_loss", patience=6, restore_best_weights=True, verbose=1
    ),
    tf.keras.callbacks.ReduceLROnPlateau(
        monitor="val_loss", factor=0.5, patience=3, min_lr=1e-7, verbose=1
    ),
]

# ---------- 13. Treino ----------
history = model.fit(
    train_dataset,
    validation_data=validation_dataset,
    epochs=40,
    callbacks=callbacks,
    class_weight=class_weights_dict,
)

# ---------- 14. Curvas ----------
fig, axes = plt.subplots(1, 2, figsize=(14, 5))

axes[0].plot(history.history["accuracy"], label="Treino")
axes[0].plot(history.history["val_accuracy"], label="Validação")
axes[0].set_title("Acurácia"); axes[0].set_xlabel("Épocas"); axes[0].legend()

axes[1].plot(history.history["loss"], label="Treino")
axes[1].plot(history.history["val_loss"], label="Validação")
axes[1].set_title("Loss"); axes[1].set_xlabel("Épocas"); axes[1].legend()

plt.tight_layout()
plt.savefig("Desempenho_DenseNet121.png", bbox_inches="tight", dpi=300)
plt.show()

# ---------- 15. Salvar / recarregar ----------
model.save("modelDenseNet121_Pneumonia.keras")
model_carregado = tf.keras.models.load_model("modelDenseNet121_Pneumonia.keras")
print("Modelo salvo e recarregado com sucesso.")

# ---------- 16. Avaliação FINAL no test (nunca visto) ----------
y_pred_prob = model.predict(test_dataset)
y_pred      = (y_pred_prob > 0.5).astype(int).flatten()
y_true      = np.concatenate([y.numpy() for _, y in test_dataset], axis=0).flatten()

print("\n=== Relatório de Classificação (TEST) ===\n")
print(classification_report(y_true, y_pred, target_names=class_names, digits=4))

# ---------- 17. Matriz de confusão ----------
cm = confusion_matrix(y_true, y_pred)
plt.figure(figsize=(8, 6))
sns.heatmap(cm, annot=True, fmt="d", cmap="gray_r",
            xticklabels=class_names, yticklabels=class_names)
plt.xlabel("Predição"); plt.ylabel("Verdadeiro")
plt.title("Matriz de Confusão — Raio-X de Tórax (TEST)")
plt.savefig("confusion_matrix_pneumonia.png", bbox_inches="tight", dpi=300)
plt.show()

# ---------- 18. Amostras para SHAP ----------
imagens_normal, imagens_pneumonia = [], []
labels_normal,  labels_pneumonia  = [], []

for images_batch, labels_batch in test_dataset:
    for img, lbl in zip(images_batch, labels_batch):
        c = int(lbl.numpy()[0])
        if c == 0 and len(imagens_normal) < 3:
            imagens_normal.append(img.numpy()); labels_normal.append(c)
        elif c == 1 and len(imagens_pneumonia) < 3:
            imagens_pneumonia.append(img.numpy()); labels_pneumonia.append(c)
    if len(imagens_normal) >= 3 and len(imagens_pneumonia) >= 3:
        break

test_sample  = np.array(imagens_normal[:2] + imagens_pneumonia[:2])
real_classes = np.array(labels_normal[:2] + labels_pneumonia[:2])

# Background: pequeno lote para o GradientExplainer
for images_batch, _ in test_dataset.take(2):
    background = images_batch.numpy()[:30]
    break

pred = model.predict(test_sample, verbose=0)
pred_classes = (pred >= 0.5).astype(int).flatten()
print("Preditas:", pred_classes)
print("Reais:   ", real_classes)

# ---------- 19. SHAP ----------
# Passar o modelo "chamável" para evitar o warning de Input nomeado
explainer   = shap.GradientExplainer(model, background)
shap_values = explainer.shap_values(test_sample)
print("Shape shap_values:", np.shape(shap_values))

# Normaliza formato de saída (varia entre versões do SHAP/Keras)
def get_shap_for(i, shap_values):
    sv = shap_values
    if isinstance(sv, list):
        sv = sv[0]
    sv = np.asarray(sv)
    if sv.ndim == 5:     # (N, H, W, C, 1)
        return sv[i, :, :, :, 0]
    elif sv.ndim == 4:   # (N, H, W, C)
        return sv[i]
    else:
        raise ValueError(f"Formato de shap_values inesperado: {sv.shape}")

for i in range(len(test_sample)):
    print(f"Pred: {class_names[pred_classes[i]]} | Real: {class_names[real_classes[i]]}")
    current_shap = get_shap_for(i, shap_values)
    current_img  = test_sample[i]

    plt.figure(figsize=(6, 6))
    shap.image_plot(current_shap, current_img, show=False)
    plt.title(f"Pred: {class_names[pred_classes[i]]} | Real: {class_names[real_classes[i]]}")
    plt.savefig(f"shap_amostra_{i}.png", bbox_inches="tight", dpi=300)
    plt.show()
    plt.close()

# ---------- 20. Métricas extras de resumo ----------
print("\n=== Resumo TEST ===")
print(f"F1 macro:      {f1_score(y_true, y_pred, average='macro'):.4f}")
print(f"Recall macro:  {recall_score(y_true, y_pred, average='macro'):.4f}")
print(f"Recall PNEUM.: {recall_score(y_true, y_pred, pos_label=1):.4f}")
print(f"Recall NORMAL: {recall_score(y_true, y_pred, pos_label=0):.4f}")