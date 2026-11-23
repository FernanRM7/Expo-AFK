#!/usr/bin/env python3
"""Train a TF-IDF ticket category classifier from tickets.csv."""

from pathlib import Path

import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline


def main() -> None:
    data_path = Path("tickets.csv")
    data = pd.read_csv(data_path)

    required_columns = {"message", "category"}
    missing_columns = required_columns.difference(data.columns)
    if missing_columns:
        raise ValueError(f"{data_path} is missing required columns: {sorted(missing_columns)}")

    X_train, X_test, y_train, y_test = train_test_split(
        data["message"],
        data["category"],
        test_size=0.2,
        stratify=data["category"],
        random_state=42,
    )

    model = Pipeline(
        [
            ("tfidf", TfidfVectorizer(ngram_range=(1, 2))),
            ("classifier", LogisticRegression(max_iter=1000)),
        ]
    )
    model.fit(X_train, y_train)

    print(f"Entrenamiento completado: {len(X_train)} ejemplos de entrenamiento.")
    print(f"Ejemplos reservados para prueba: {len(X_test)}.")
    predictions = model.predict(X_test)

    print("\nReporte de clasificación:")
    print(classification_report(y_test, predictions, zero_division=0))
    print("Matriz de confusión:")
    print(confusion_matrix(y_test, predictions, labels=model.classes_))

    new_message = ["Encontré datos de otros clientes"]
    category = model.predict(new_message)[0]
    confidence = model.predict_proba(new_message).max()

    print("Categoría:", category)
    print("Score aproximado:", round(confidence, 3))


if __name__ == "__main__":
    main()
