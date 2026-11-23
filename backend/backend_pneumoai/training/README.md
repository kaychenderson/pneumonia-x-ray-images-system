# Treinamento (fora do backend)

`train_densenet121.py` é o pipeline de treino original, **sem alterações**. Ele não é importado
pelo Django: serve para reproduzir/retreinar o modelo. O backend só precisa do arquivo
`modelDenseNet121_Pneumonia.keras` gerado por ele.

    python -m venv .venv-train && source .venv-train/bin/activate
    pip install tensorflow shap kagglehub scikit-learn pandas seaborn matplotlib
    python train_densenet121.py
    mv modelDenseNet121_Pneumonia.keras ../ml_models/

Mantenha treino e servidor com a mesma major de Keras/TensorFlow.

## Cuidado com a divisão treino/servidor (train/serve skew)

No treino, o `/255` é aplicado no `tf.data` (função `normalize`) e **não** faz parte do modelo salvo.
O backend replica isso em `apps/inference/service.py`. Se um dia retreinar, considere incluir
`layers.Rescaling(1/255)` dentro do modelo: assim o `.keras` fica autocontido e esse risco some
(nesse caso, remova a divisão por 255 do serviço de inferência).
