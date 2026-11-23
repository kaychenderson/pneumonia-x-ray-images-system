# Modelo treinado

Coloque aqui o arquivo gerado pelo treino:

    ml_models/modelDenseNet121_Pneumonia.keras

(ou aponte outro caminho em `MODEL_PATH`). Arquivos `.keras` não vão para o Git (ver `.gitignore`).

Validar o arquivo e testar uma radiografia:

    python manage.py check_model
    python manage.py check_model --image /caminho/radiografia.jpeg

## Contrato com o treino

| Item            | Valor                                                                  |
|-----------------|------------------------------------------------------------------------|
| Entrada         | RGB 224×224, `tf.image.resize` bilinear                                |
| Normalização    | `pixel / 255.0` (feita FORA do modelo no treino; o backend a refaz)    |
| Saída           | 1 neurônio sigmoid = P(PNEUMONIA)                                      |
| Ordem de classes| `["NORMAL", "PNEUMONIA"]` (alfabética, como `image_dataset_from_directory`) |
| Limiar          | `MODEL_THRESHOLD` (0,5 por padrão, igual à avaliação no treino)        |

A versão do Keras usada para **carregar** deve ser compatível com a usada para **salvar** o `.keras`
(use a mesma major, Keras 3 para TensorFlow ≥ 2.16).
Se você retreinar com outra ordem de classes, ajuste `MODEL_CLASS_NAMES`.
